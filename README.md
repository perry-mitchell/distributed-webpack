# Distributed Webpack
Run large webpack builds on multiple machines

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

_To be continued._
