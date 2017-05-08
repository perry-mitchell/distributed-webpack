const http = require("http");
const { server: WebsocketServer } = require("websocket");
const { EventEmitter: Events } = require("events");

function handleRequest(progressServer, request) {
    if (!originAllowed(request.origin)) {
        request.reject();
        return;
    }
    const connection = request.accept("distributed-webpack-progress", request.origin);
    connection.on("message", function(message) {
        if (message.type === "utf8") {
            progressServer.onMessage(JSON.parse(message.utf8Data));
        }
    });
    connection.on("close", () => progressServer.onClose());
}

function originAllowed(origin) {
    return true;
}

class ProgressServer extends Events {

    constructor(listenPort) {
        super();
        this._connections = [];
        this._httpServer = http.createServer(function(req, res) {
            res.writeHead(404);
            res.end();
        });
        this._httpServer.listen(listenPort, function() {
            console.log(`Progress tracking server listening on port ${listenPort}`);
        });
        this._httpServer.on("connection", socket => {
            this._connections.push(socket);
            socket.on("close", () => {
                this._connections.splice(this._connections.indexOf(socket), 1);
            });
        });
        this._wsServer = new WebsocketServer({
            httpServer: this._httpServer,
            autoAcceptConnections: false
        });
        this._wsServer.on("request", request => handleRequest(this, request));
    }

    close() {
        this._wsServer.shutDown();
        this._connections.forEach(function(socket) {
            try {
                socket.destroy();
            } catch (err) {}
        });
        this._connections = [];
        this._httpServer.close();
    }

    onClose() {
        // handle closing of client ?
    }

    onMessage(packet) {
        if (packet.type === "moduleComplete") {
            this.emit("moduleComplete", {
                nodeID: packet.nodeID,
                count: packet.count
            });
        }
    }

}

module.exports = ProgressServer;
