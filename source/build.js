const path = require("path");
const fs = require("fs");

const execa = require("execa");
const copy = require("copy");
const pify = require("pify");
const NodeSSH = require("node-ssh");
const rimraf = require("rimraf").sync;
const mkdirp = require("mkdirp").sync;

const copyFiles = pify(copy);

const FILTER_STDOUT = result => result.stdout;
const REMOTE_PATH = "PATH=/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin";

function archiveProject() {
    const cwd = getCurrentDir();
    console.log("Archiving project...");
    return execa("zip", ["-r", "dist.zip", "./", "-x", "*node_modules*", "-x", "*.git*"], { cwd });
}

function copyExeHelpers(nodeConfig) {
    const distWpSourceDir = path.resolve(__dirname, "./cli");
    const { ssh } = nodeConfig;
    return Promise.all([
        ssh.putFile(
            path.join(distWpSourceDir, "distwp_files.sh"),
            path.join(nodeConfig.workingDir, "distwp_files.sh")
        )
    ]);
}

function copyRemoteArtifacts(nodeConfig) {
    const { nodeType, artifacts } = nodeConfig;
    if (artifacts && artifacts.length > 0) {
        console.log("Copying build artifacts...");
        artifacts.forEach(function(artifact) {
            mkdirp(artifact.local);
        });
        if (nodeType === "local") {
            return Promise
                .all(artifacts.map(artifact =>
                    copyFiles(artifact.remote, artifact.local)
                ));
        } else if (nodeType === "ssh") {
            const { ssh } = nodeConfig;
            return copyExeHelpers(nodeConfig)
                .then(() => Promise.all(artifacts.map(artifact =>
                    ssh
                        .execCommand(
                            `bash ${path.join(nodeConfig.workingDir, "distwp_files.sh")} "${artifact.remote}"`
                        )
                        .then(handleRemoteExecResponse)
                        .then(function(result) {
                            const files = result.stdout
                                .split("\n")
                                .map(filename => filename.trim())
                                .filter(filename => filename.length > 0);
                            let downloadChain = Promise.resolve();
                            files.forEach(function(remoteFilename) {
                                const localFilename = path.join(artifact.local, path.basename(remoteFilename));
                                downloadChain = downloadChain.then(function() {
                                    return ssh.getFile(localFilename, remoteFilename);
                                });
                            });
                            return downloadChain;
                        })
                )))
        }
    }
    return Promise.resolve();
}

function createWebpackText(start, end) {
    return `
        "use strict";
        const wpConfigs = require("./original.webpack.config.js");
        module.exports = wpConfigs.slice(${start}, ${end} + 1);
    `;
}

function disposeOfNodeConfig(nodeConfig) {
    if (nodeConfig.ssh) {
        nodeConfig.ssh.dispose();
        delete nodeConfig.ssh;
    }
}

function executeConfig(mainConfig, nodeConfig, start, end) {
    const name = getNodeConfigName(nodeConfig);
    console.log(`Building project (${start} -> ${end}) (${name})...`);
    const { nodeType, workingDir } = nodeConfig;
    if (nodeType === "local") {
        return execa("mv", ["webpack.config.js", "original.webpack.config.js"], { cwd: workingDir })
            .then(() => new Promise(function(resolve, reject) {
                fs.writeFile(path.join(workingDir, "webpack.config.js"), createWebpackText(start, end), function(err) {
                    if (err) {
                        return reject(err);
                    }
                    return resolve();
                });
            }))
            .then(() => execa(mainConfig.webpack.buildCommand, mainConfig.webpack.buildArgs, { cwd: workingDir }));
    } else if (nodeType === "ssh") {
        const randNum = Math.floor(Math.random() * 1000);
        const tempWebpackPath = path.resolve(__dirname, `./tmp${randNum}.webpack.config.js`);
        fs.writeFileSync(tempWebpackPath, createWebpackText(start, end));
        const removeTempWebpack = () => rimraf(tempWebpackPath);
        const { ssh } = nodeConfig;
        return ssh
            .execCommand(
                "mv webpack.config.js original.webpack.config.js",
                { cwd: nodeConfig.workingDir }
            )
            .then(handleRemoteExecResponse)
            .then(() => ssh.putFile(
                tempWebpackPath,
                path.join(workingDir, "webpack.config.js")
            ))
            .then(() => removeTempWebpack())
            .then(() => ssh.execCommand(
                `${REMOTE_PATH} ${mainConfig.webpack.buildCommand} ${mainConfig.webpack.buildArgs.join(" ")}`,
                { cwd: nodeConfig.workingDir }
            ))
            .then(handleRemoteExecResponse)
            .catch(function(err) {
                removeTempWebpack();
                throw err;
            });
    }
    throw new Error(`Unknown node type: ${sendType}`);
}

function getConfig() {
    const cwd = getCurrentDir();
    return require(path.join(cwd, "./dist.webpack.config.js"));
}

function getCurrentDir() {
    return FILTER_STDOUT(execa.shellSync("pwd"));
}

function getNodeConfigName(nodeConfig) {
    if (nodeConfig.nodeType === "local") {
        return `local:${nodeConfig.workingDir}`;
    } else if (nodeConfig.nodeType === "ssh") {
        return `ssh:${nodeConfig.host}`;
    }
    return "";
}

function getScriptsCount() {
    const cwd = getCurrentDir();
    return require(path.join(cwd, "./webpack.config.js")).length;
}

function getTempDirectory(nodeConfig) {
    return nodeConfig.tempDir || "/tmp";
}

function handleRemoteExecResponse(result) {
    if (result.code !== 0) {
        throw new Error(`Failed executing remote command: Bad exit code: ${result.code}\n${result.stderr}`);
    }
    return result;
}

function installPackage(nodeConfig) {
    const name = getNodeConfigName(nodeConfig);
    console.log(`Installing project (${name})...`);
    const cwd = getCurrentDir();
    const { nodeType } = nodeConfig;
    if (nodeType === "local") {
        return execa("npm", ["install"], { cwd: nodeConfig.workingDir });
    } else if (nodeType === "ssh") {
        const { ssh } = nodeConfig;
        return ssh
            .execCommand(
                `${REMOTE_PATH} npm install`,
                { cwd: nodeConfig.workingDir }
            )
            .then(handleRemoteExecResponse);
    }
    throw new Error(`Unknown node type: ${nodeType}`);
}

function performBuild() {
    const config = getConfig();
    const nodeConfigs = config.nodes;
    const numItems = getScriptsCount();
    const totalWeight = nodeConfigs.reduce((running, next) => running + next.weight, 0);
    let itemsLeft = numItems,
        workNextIndex = 0;
    const configWorkCount = nodeConfigs.map(function(nodeConfig) {
        let percentage = nodeConfig.weight / totalWeight,
            count = Math.ceil(percentage * itemsLeft);
        if (count > itemsLeft) {
            count = itemsLeft
        };
        itemsLeft -= count;
        return count;
    });
    console.log(`Artifacts: ${numItems}`);
    return archiveProject()
        .then(() => Promise
            .all(nodeConfigs.map(
                nodeConfig => processConfig(nodeConfig)
                    .then(() => installPackage(nodeConfig))
            ))
        )
        .then(removeArchive)
        .then(() => Promise
            .all(nodeConfigs.map(function(nodeConfig, index) {
                let count = configWorkCount[index],
                    first = workNextIndex,
                    last = first + count - 1;
                workNextIndex = first + count;
                return executeConfig(config, nodeConfig, first, last)
                    .then(() => copyRemoteArtifacts(nodeConfig))
                    .then(() => disposeOfNodeConfig(nodeConfig));
            }))
        )
        .then(function() {
            console.log("Done.");
        });
}

function prepareSSH(nodeConfig) {
    const ssh = new NodeSSH();
    return ssh
        .connect({
            host: nodeConfig.host,
            username: nodeConfig.username,
            password: nodeConfig.password,
            keepaliveInterval: 10000
        })
        .then(function() {
            nodeConfig.ssh = ssh;
        });
}

function processConfig(nodeConfig) {
    if (nodeConfig.nodeType === "ssh") {
        console.log(`Preparing SSH connection to ${nodeConfig.host}...`);
        return prepareSSH(nodeConfig)
            .then(() => sendPackage(nodeConfig));
    }
    return sendPackage(nodeConfig);
}

function removeArchive() {
    return execa("rm", ["dist.zip"]);
}

function sendPackage(nodeConfig) {
    console.log("Transferring project...");
    const cwd = getCurrentDir();
    const remoteTemp = getTempDirectory(nodeConfig);
    const sendType = nodeConfig.nodeType;
    if (sendType === "local") {
        return execa("mkdir", ["-p", nodeConfig.workingDir])
            .then(() => execa("unzip", ["-o", path.join(cwd, "./dist.zip"), "-d", nodeConfig.workingDir], { cwd }))
    } else if (sendType === "ssh") {
        const { ssh } = nodeConfig;
        return ssh
            .mkdir(nodeConfig.workingDir)
            .then(() => ssh.putFile(
                path.join(cwd, "./dist.zip"),
                path.join(remoteTemp, "./dist.zip")
            ))
            .then(() => ssh.exec(
                "unzip",
                ["-o", path.join(remoteTemp, "./dist.zip"), "-d", nodeConfig.workingDir]
            ));
    }
    throw new Error(`Unknown node type: ${sendType}`);
}

module.exports = {
    performBuild
};
