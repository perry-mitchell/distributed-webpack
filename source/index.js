#!/usr/bin/env node

const argv = require("minimist")(process.argv.slice(2));

const { performBuild } = require("./build.js");

const command = argv._[0];

switch (command) {
    case "build": {
        performBuild()
            .catch(function(err) {
                console.error(`Failed: ${err.message}`);
                process.exit(2);
            });
        break;
    }

    default: {
        console.error("No command or invalid command specified");
        process.exit(1);
    }
}
