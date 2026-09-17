#!/bin/bash
# remove-card-shadows.sh
# Run this script to remove default shadows from Youbot cards

# 1. components/ui/card.tsx
sed -i '' 's/ shadow-sm//g' /Users/pretheesh/Projects/youbot-workspace/youbot/youbot-core/web-ui/components/ui/card.tsx || true

# 2. components/login-screen.tsx
sed -i '' 's/ shadow-lg//g' /Users/pretheesh/Projects/youbot-workspace/youbot/youbot-core/web-ui/components/login-screen.tsx || true

# 3. app/tools/page.tsx
sed -i '' 's/ shadow-sm//g' /Users/pretheesh/Projects/youbot-workspace/youbot/youbot-core/web-ui/app/tools/page.tsx || true

echo "Removed shadows from cards."
