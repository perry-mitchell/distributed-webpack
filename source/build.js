const path = require("path");
const fs = require("fs");

const execa = require("execa");

const FILTER_STDOUT = result => result.stdout;

function archiveProject() {
    const cwd = getCurrentDir();
    console.log("Archiving project...");
    return execa("zip", ["-r", "dist.zip", "./", "-x", "*node_modules*", "-x", "*.git*"], { cwd })
        .then(function() {
            console.log(" - Done");
        });
}

function createWebpackText(start, end) {
    return `
        "use strict";
        const wpConfigs = require("./original.webpack.config.js");
        module.exports = wpConfigs.slice(${start}, ${end} + 1);
    `;
}

function executeConfig(config, start, end) {
    console.log(`Building project (${start}-${end})...`);
    const cwd = getCurrentDir();
    const { nodeType } = config;
    if (nodeType === "local") {
        return execa("mv", ["webpack.config.js", "original.webpack.config.js"], { cwd })
            .then(() => new Promise(function(resolve, reject) {
                fs.writeFile(path.join(cwd, "webpack.config.js"), createWebpackText(start, end), function(err) {
                    if (err) {
                        return reject(err);
                    }
                    return resolve();
                });
            }))
            .then(() => execa("./node_modules/.bin/parallel-webpack", [], { cwd }));
    } else if (nodeType === "ssh") {

    }
    throw new Error(`Unknown node type: ${sendType}`);
}

function getConfigs() {
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
    const configs = getConfigs();
    const numItems = getScriptsCount();
    const totalWeight = configs.reduce((running, next) => running + next, 0);
    let itemsLeft = numItems,
        workNextIndex = 0;
    const configWorkCount = configs.map(function(config) {
        let percentage = config.weight / totalWeight,
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
            .all(configs.map(
                config => processConfig(config)
                    .then(() => installPackage(config))
            ))
        )
        .then(removeArchive)
        .then(() => Promise
            .all(configs.map(function(config, index) {
                let count = configWorkCount[index],
                    first = workNextIndex,
                    last = first + count - 1;
                workNextIndex = first + count;
                return executeConfig(config, first, last);
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
