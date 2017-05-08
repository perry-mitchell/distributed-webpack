const fs = require("fs");
const path = require("path");
const { client: WebsocketClient } = require("websocket");

const ENABLED = global.__distWebpack__ !== true;

let completedModules = 0;

function DistributedProgressPlugin(options) {
    if (!ENABLED) {
        return;
    }
    this._wsClient = new WebsocketClient();
    this._rootDir = options.root;
    const nodeInfo = fs.readFileSync(path.resolve(this._rootDir, "./dist-node.info"), "utf8");
    const [nodeID, serverIP, serverPort] = nodeInfo.split(",");
    this._aspect = {
        nodeID,
        serverIP,
        serverPort
    };
    // this.completedModules = 0;
    this._wsClient.on("connectFailed", err => {
        // handle failure
    });
    this._wsClient.on("connect", connection => {
        this.connection = connection;
    });
    this._wsClient.connect(`ws://${serverIP}:${serverPort}/`, "distributed-webpack-progress");
}

DistributedProgressPlugin.prototype.apply = function(compiler) {
    if (!ENABLED) {
        return;
    }
    compiler.plugin("after-emit", (compilation, cb) => {
        completedModules += 1;
        if (this.connection && this.connection.connected) {
            this.connection.sendUTF(JSON.stringify({
                type: "moduleComplete",
                nodeID: this._aspect.nodeID,
                count: completedModules
            }));
        }
        cb();
    });
    compiler.plugin("done", () => {
        if (this.connection && this.connection.connected) {
            this.connection.close();
        }
    });
};

module.exports = DistributedProgressPlugin;
