#!/bin/sh
set -e

# Start gunicorn
exec gunicorn --bind 0.0.0.0:3000 --worker-class gevent --workers 4 --timeout 120 app:app
