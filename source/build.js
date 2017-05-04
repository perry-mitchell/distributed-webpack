const path = require("path");
const fs = require("fs");

const execa = require("execa");
const copy = require("copy");
const pify = require("pify");

const copyFiles = pify(copy);

const FILTER_STDOUT = result => result.stdout;

function archiveProject() {
    const cwd = getCurrentDir();
    console.log("Archiving project...");
    return execa("zip", ["-r", "dist.zip", "./", "-x", "*node_modules*", "-x", "*.git*"], { cwd });
}

function copyRemoteArtifacts(nodeConfig) {
    const { nodeType, artifacts } = nodeConfig;
    if (artifacts && artifacts.length > 0) {
        console.log("Copying build artifacts...");
        if (nodeType === "local") {
            return Promise
                .all(artifacts.map(artifact =>
                    copyFiles(artifact.remote, artifact.local)
                ));
        } else if (nodeType === "ssh") {

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

function executeConfig(mainConfig, nodeConfig, start, end) {
    console.log(`Building project (${start} -> ${end})...`);
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

function getScriptsCount() {
    const cwd = getCurrentDir();
    return require(path.join(cwd, "./webpack.config.js")).length;
}

function installPackage(config) {
    console.log("Installing project...");
    const cwd = getCurrentDir();
    const { nodeType } = config;
    if (nodeType === "local") {
        return execa("npm", ["install"], { cwd: config.workingDir });
    } else if (nodeType === "ssh") {

    }
    throw new Error(`Unknown node type: ${sendType}`);
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
                    .then(() => copyRemoteArtifacts(nodeConfig));
            }))
        );
}

function processConfig(config) {
    return sendPackage(config);
}

function removeArchive() {
    return execa("rm", ["dist.zip"]);
}

function sendPackage(config) {
    console.log("Transferring project...");
    const cwd = getCurrentDir();
    const sendType = config.nodeType;
    if (sendType === "local") {
        return execa("mkdir", ["-p", config.workingDir])
            .then(() => execa("unzip", ["-o", path.join(cwd, "./dist.zip"), "-d", config.workingDir], { cwd }))
    } else if (sendType === "ssh") {

    }
    throw new Error(`Unknown node type: ${sendType}`);
}

module.exports = {
    performBuild
};
