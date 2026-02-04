#!/bin/bash
# tests/live/flow/admin/content-search-combobox/run-all.sh
# Run all ContentSearchCombobox tests with summary

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../../.." && pwd)"

cd "$PROJECT_ROOT"

echo "=========================================="
echo "ContentSearchCombobox Test Suite"
echo "=========================================="
echo ""

# Check if dev server is running
if ! curl -s http://localhost:3111 > /dev/null 2>&1; then
    echo "Warning: Dev server not running on port 3111"
    echo "   Start with: npm run dev"
    echo ""
    echo "Starting dev server in background..."
    npm run dev &
    DEV_PID=$!
    sleep 10
    trap "kill $DEV_PID 2>/dev/null" EXIT
fi

# Run tests
echo "Running tests..."
echo ""

npx playwright test tests/live/flow/admin/content-search-combobox/ \
    --reporter=line \
    --timeout=60000 \
    "$@"

EXIT_CODE=$?

echo ""
echo "=========================================="
if [ $EXIT_CODE -eq 0 ]; then
    echo "All tests passed!"
else
    echo "Some tests failed (exit code: $EXIT_CODE)"
fi
echo "=========================================="

exit $EXIT_CODE
