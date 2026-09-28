#!/bin/bash
set -e

DEPLOY=${1:-10.0.1.88}

echo "Deploying to $DEPLOY"
if [ "$1" != "nobuild" ]; then
	make frontend && make build_dev
fi

scp bin/kvm_app root@$DEPLOY:/userdata/picokvm/bin/kvm_app.new
ssh root@$DEPLOY 'mv /userdata/picokvm/bin/kvm_app.new /userdata/picokvm/bin/kvm_app && /etc/init.d/S99kvmapp restart'
