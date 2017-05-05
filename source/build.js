const path = require("path");
const fs = require("fs");
const assert = require("assert");

const execa = require("execa");
const copy = require("copy");
const pify = require("pify");
const NodeSSH = require("node-ssh");
const rimraf = require("rimraf").sync;
const mkdirp = require("mkdirp").sync;
const ProgressBar = require("node-progress-bars");
const timeSpan = require("time-span");
const fileExists = require("file-exists").sync;

const copyFiles = pify(copy);

const FILTER_STDOUT = result => result.stdout;
const REMOTE_PATH = "PATH=/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin";

// Progress items:
//  - Transfer
//  - Install
//  - Build
//  - Copy
//  - Done
const PROGRESS_TOTAL = 5;

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
    updateProgress(nodeConfig, "Retrieve build artifacts");
    if (artifacts && artifacts.length > 0) {
        artifacts.forEach(function(artifact) {
            mkdirp(artifact.local);
        });
        if (nodeType === "local") {
            return Promise
                .all(artifacts.map(artifact =>
                    copyFiles(artifact.remote, artifact.local)
                ))
                .then(function() {
                    updateProgress(nodeConfig, "Retrieved artifacts", true);
                });
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
                .then(function() {
                    updateProgress(nodeConfig, "Retrieved artifacts", true);
                });
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

function executeConfig(mainConfig, nodeConfig) {
    const name = getNodeConfigName(nodeConfig);
    const { first: start, last: end } = nodeConfig;
    updateProgress(nodeConfig, `Build project (${start} -> ${end})`);
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
            .then(() => execa(mainConfig.webpack.buildCommand, mainConfig.webpack.buildArgs, { cwd: workingDir }))
            .then(function() {
                updateProgress(nodeConfig, "Built project", true);
            });
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
            .then(function() {
                updateProgress(nodeConfig, "Built project", true);
            })
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

function getScriptNames() {
    const cwd = getCurrentDir();
    return require(path.join(cwd, "./webpack.config.js"))
        .map(config => config.output.filename);
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
    updateProgress(nodeConfig, "Install project");
    const cwd = getCurrentDir();
    const { nodeType } = nodeConfig;
    if (nodeType === "local") {
        return execa("npm", ["install"], { cwd: nodeConfig.workingDir })
            .then(function() {
                updateProgress(nodeConfig, "Installed project", true);
            });
    } else if (nodeType === "ssh") {
        const { ssh } = nodeConfig;
        return ssh
            .execCommand(
                `${REMOTE_PATH} npm install`,
                { cwd: nodeConfig.workingDir }
            )
            .then(handleRemoteExecResponse)
            .then(function() {
                updateProgress(nodeConfig, "Installed project", true);
            });
    }
    throw new Error(`Unknown node type: ${nodeType}`);
}

function performBuild() {
    const config = getConfig();
    const nodeConfigs = config.nodes;
    const numItems = getScriptsCount();
    const totalWeight = nodeConfigs.reduce((running, next) => running + next.weight, 0);
    const endTiming = timeSpan();
    let itemsLeft = numItems,
        workNextIndex = 0;
    const configWorkCount = nodeConfigs.map(function(nodeConfig) {
        let percentage = nodeConfig.weight / totalWeight,
            count = Math.ceil(percentage * numItems);
        if (count > itemsLeft) {
            count = itemsLeft
        };
        itemsLeft -= count;
        return count;
    });
    console.log(`Artifacts: ${numItems}`);
    nodeConfigs.forEach(function(nodeConfig, index) {
        let count = configWorkCount[index],
            first = workNextIndex,
            last = first + count - 1;
        workNextIndex = first + count;
        nodeConfig.first = first;
        nodeConfig.last = last;
        console.log(`  - ${getNodeConfigName(nodeConfig)} => ${first} -> ${last} (${last - first + 1})`);
    });
    return archiveProject()
        .then(function() {
            console.log("Building...");
        })
        .then(() => Promise
            .all(nodeConfigs.map(
                nodeConfig => processConfig(nodeConfig)
                    .then(() => installPackage(nodeConfig))
            ))
        )
        .then(removeArchive)
        .then(() => Promise
            .all(nodeConfigs.map(function(nodeConfig) {
                return executeConfig(config, nodeConfig)
                    .then(() => copyRemoteArtifacts(nodeConfig))
                    .then(() => disposeOfNodeConfig(nodeConfig))
                    .then(function() {
                        updateProgress(nodeConfig, "Done", true);
                    });
            }))
        )
        .then(() => verifyArtifacts(config, nodeConfigs))
        .then(function() {
            nodeConfigs.forEach(function(nodeConfig) {
                nodeConfig.progressBar.clear();
            });
            console.log(`Done in ${endTiming.sec()} seconds`);
        });
}

function prepareSSH(nodeConfig) {
    const ssh = new NodeSSH();
    const connectionInfo = {
        host: nodeConfig.host,
        username: nodeConfig.username,
        keepaliveInterval: 10000
    };
    if (nodeConfig.password) {
        connectionInfo.password = nodeConfig.password;
    } else if (nodeConfig.privateKey) {
        connectionInfo.privateKey = nodeConfig.privateKey;
    }
    return ssh
        .connect(connectionInfo)
        .then(function() {
            nodeConfig.ssh = ssh;
        });
}

function processConfig(nodeConfig) {
    if (nodeConfig.nodeType === "ssh") {
        updateProgress(nodeConfig, "Prepare SSH connection");
        return prepareSSH(nodeConfig)
            .then(() => sendPackage(nodeConfig));
    }
    return sendPackage(nodeConfig);
}

function removeArchive() {
    return execa("rm", ["dist.zip"]);
}

function sendPackage(nodeConfig) {
    updateProgress(nodeConfig, "Transfer project");
    const cwd = getCurrentDir();
    const remoteTemp = getTempDirectory(nodeConfig);
    const sendType = nodeConfig.nodeType;
    if (sendType === "local") {
        return execa("mkdir", ["-p", nodeConfig.workingDir])
            .then(() => execa("unzip", ["-o", path.join(cwd, "./dist.zip"), "-d", nodeConfig.workingDir], { cwd }))
            .then(function() {
                updateProgress(nodeConfig, "Transferred project", true);
            });
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
            ))
            .then(function() {
                updateProgress(nodeConfig, "Transferred project", true);
            });
    }
    throw new Error(`Unknown node type: ${sendType}`);
}

function updateProgress(nodeConfig, currentTask, bump = false) {
    if (!nodeConfig.progressBar) {
        nodeConfig.progressBar = new ProgressBar({
            schema: "[:bar] (:current/:total :elapseds) :task",
            total: PROGRESS_TOTAL,
            blank: "░",
            filled: "▓"
        });
    }
    const tick = bump ? 1 : 0;
    nodeConfig.progressBar.tick(tick, { task: currentTask });
}

function verifyArtifacts(config, nodeConfigs) {
    if (config.verify && config.verify.outputDirectory) {
        const expectedFilenames = getScriptNames();
        const nonExisting = expectedFilenames
            .filter(function(filename) {
                if (config.verify.filenameRegex) {
                    return config.verify.filenameRegex.test(filename);
                }
                return true;
            })
            .filter(function(filename) {
                const fullPath = path.join(config.verify.outputDirectory, filename);
                return !fileExists(fullPath);
            });
        if (nonExisting.length > 0) {
            console.log("Missing files:");
            nonExisting.forEach(function(missingFilename) {
                console.log(`  ${missingFilename}`);
            });
            throw new Error(`Verfication failed: ${nonExisting.length} files did not exist after build`);
        }
    }
}

module.exports = {
    performBuild
};
