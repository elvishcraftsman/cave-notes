#!/bin/bash

PROJECT_DIR="/home/lynn/Sync/Technical/Projects/cave-notes"
FILE="$PROJECT_DIR/node_modules/electron/dist/chrome-sandbox"

# Change directory to project root first
cd "$PROJECT_DIR" || exit 1

# If file doesn't exist, run npm install in the project root
if [ ! -f "$FILE" ]; then
    echo "chrome-sandbox not found. Running npm install in project root..."
    npm install
fi

# Re-check if file exists after running npm install
if [ ! -f "$FILE" ]; then
    echo "Error: File still does not exist at $FILE"
    exit 1
fi

# Get current permissions (octal) and owner/group
PERMS=$(stat -c "%a" "$FILE")
OWNER=$(stat -c "%U:%G" "$FILE")

# Target settings
TARGET_PERMS="4755"
TARGET_OWNER="root:root"

# Check if settings match
if [ "$PERMS" = "$TARGET_PERMS" ] && [ "$OWNER" = "$TARGET_OWNER" ]; then
    echo "Permissions and ownership are already correct ($OWNER, $PERMS)."
else
    echo "Settings incorrect. Current: $OWNER ($PERMS). Updating..."
    sudo chown root:root "$FILE" && sudo chmod 4755 "$FILE"
    
    if [ $? -eq 0 ]; then
        echo "Successfully updated $FILE to root:root 4755."
    else
        echo "Failed to update settings."
        exit 1
    fi
fi

# Launch application from desktop app folder
cd "$PROJECT_DIR/apps/desktop" || exit 1
npm start
