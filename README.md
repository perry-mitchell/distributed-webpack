# Distributed Webpack
Run large webpack builds on multiple machines

[![npm version](https://badge.fury.io/js/distributed-webpack.svg)](https://www.npmjs.com/package/distributed-webpack)

## About
Much like [parallel-webpack](https://github.com/trivago/parallel-webpack), **distributed-webpack** is designed to make building _multiple_ configurations faster and more efficient. This project was born out of the requirement to build _hundreds_ of configurations (of scripts with sizes between 1-2mb) where tools like parallel-webpack and [happypack](https://github.com/amireh/happypack) where simply not enough (though they help enormously when compared with standard webpack execution).

This library is designed to allow the execution of webpack configurations on multiple machines and allows, via configuration, the specification of the exact command (and parameters) to execute. This means that tools like parallel-webpack can be used in combination with distributed-webpack to achieve even greater parallelism.

## Installation
This library is a build tool, so you should (in most cases) save it as a dev dependency:

```bash
npm install distributed-webpack --save-dev
```

This library has webpack has a **peer dependency**, so you should definitely have that already installed. distributed-webpack reinstalls all modules specified in `package.json` on the target machines, so webpack (and any other required build tools) should be specified in `package.json` for it to be installed remotely.

## Configuration
Configuration of distributed-webpack is made by providing a `dist.webpack.config.js` file in the root directory of the project, alongside a `webpack.config.js` file for regular webpack execution. This new config file will house the definitions of the nodes (to perform building) and their weight (how much of the work will be performed on the node).

Within the configuration file, you should export a single object:

```javascript
module.exports = {

    nodes: [

        {
            nodeType: "local",
            weight: 50,
            workingDir: "/home/user/Temp/dist-wp-build",
            artifacts: [
                {
                    remote: "/home/user/Temp/dist-wp-build/dist/*.js",
                    local: "/home/user/work/project/dist/"
                }
            ]
        }

    ],

    webpack: {
        buildCommand: "./node_modules/.bin/webpack",
        buildArgs: []
    }

};
```

### Options

#### nodes
An array of [node configurations](#node-configurations).

#### webpack
Webpack-specific configuration (for running on remotes).

### Node configurations
Nodes are where the work is done, and can be one of two types: `local` or `ssh`.

#### node.nodeType
A **required** field denoting the type of node. Can be either `local` or `ssh`.

#### node.weight
A **required** integer denoting the amount of work that should be done on this node compared to others. Weights can be in any range, and are compared to one another. For example, if a node has a weight of `100` and another of `10`, the first will get 10 times the work of the second.

#### node.workingDir
A **required** string holding the _remote_ working directory (where to copy the project to). Must be absolute.

#### node.host
The IP address or hostname of the remote machine to connect to. Required for `ssh` node types.

#### node.username
The SSH username to connect to the remote machine. Required for `ssh` node types.

#### node.password
The SSH password to authenticate the user with on the remote machine. May be required for `ssh` node types.

#### node.artifacts
An array of built artifacts to be retrieved after building. This is an array of objects that resemble the following:

```javascript
{
    remote: "/home/user/Temp/dist-wp-build/dist/*.js",
    local: "/home/user/work/project/dist/"
}
```

Assets matching the `remote` pattern are copied from the remote source into the `local` directory.
