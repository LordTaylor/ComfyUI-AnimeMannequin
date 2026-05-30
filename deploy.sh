#!/bin/bash
set -e
TARGET="krawczyk@192.168.50.199:/mnt/windows/Users/HerwinKomp/Documents/ComfyUI/custom_nodes/ComfyUI-AnimeMannequin/"
rsync -az --delete --exclude '.git' --exclude 'node_modules' --exclude 'tests/js' --exclude 'package*.json' ./ "$TARGET"
echo "Deployed"
