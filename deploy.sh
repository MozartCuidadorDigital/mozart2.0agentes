#!/bin/bash

set -ex

echo "=== START DEPLOY AGENTES ==="
whoami
pwd

cd /home/ubuntu/mozart2.0agentes

echo "Fix git safe directory..."
git config --system --add safe.directory /home/ubuntu/mozart2.0agentes

echo "Pull latest code..."
git pull origin main

echo "Install deps..."
npm install

echo "Build..."
npm run build || true

echo "Restart service..."
pm2 restart all || npm run start

echo "Deploy agentes completado"