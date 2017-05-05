#!/bin/bash

SOURCEPATH=$1

shopt -s nullglob
list=($SOURCEPATH)
for file in "${list[@]}"; do echo "$file"; done
