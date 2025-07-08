# Google Calendar Tools - User Guide

Welcome to Google Calendar Tools, a powerful Chrome extension that enhances Google Calendar with productivity features to streamline your scheduling workflow.

## Table of Contents

- [Installation](#installation)
- [Initial Setup](#initial-setup)
- [Features Overview](#features-overview)
- [Feature Details](#feature-details)
- [Troubleshooting](#troubleshooting)
- [Privacy & Security](#privacy--security)
- [FAQ](#faq)

## Installation

### Step 1: Download the Extension

1. Download the extension package from the Chrome Web Store (coming soon) or from the developer
2. If you received a `.zip` file, extract it to a folder on your computer

### Step 2: Install in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **"Load unpacked"**
4. Select the extracted extension folder (the one containing `manifest.json`)
5. The extension will appear in your extensions list

### Step 3: Verify Installation

- Look for the Google Calendar Tools icon in your Chrome toolbar
- Visit [Google Calendar](https://calendar.google.com) - you should see new productivity features

## Initial Setup

### Google Calendar API Configuration (Optional)

For the best performance, set up API access:

1. **Why API Setup?** 
   - Much faster bulk operations (seconds vs. minutes)
   - Better reliability for large numbers of events
   - Real-time progress tracking

2. **Quick Setup:**
   - The extension works immediately without API setup
   - API features enhance performance but aren't required
   - The extension will automatically use the best available method

3. **Advanced API Setup** (for power users):
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a project and enable the Google Calendar API
   - Create OAuth2 credentials for Chrome Extension
   - Configure the extension with your client ID
   - See detailed setup instructions in the [README.md](README.md)

## Features Overview

Google Calendar Tools adds four main productivity features to Google Calendar:

1. **🔄 Duplicate Events** - One-click event duplication
2. **📅 Copy Day** - Copy entire day schedules
3. **📋 Bulk Operations** - Select and copy multiple events
4. **⏱️ Quick Duration** - Instant duration adjustments

## Feature Details

### 🔄 Duplicate Events

**What it does:** Instantly duplicate any event to the next day

**How to use:**
1. Hover over any event in your calendar
2. Look for the **duplicate icon** (appears next to edit/delete)
3. Click the icon to create a copy for tomorrow
4. A success notification confirms the duplication

**Perfect for:**
- Daily recurring meetings
- Regular appointments
- Template events you use frequently

---

### 📅 Copy Day

**What it does:** Copy your entire schedule from one day to another

**How to use:**
1. **Start Copy Mode:**
   - Look for the **"Copy Day"** icon in the day header
   - Click it to activate copy mode

2. **Select Target Day:**
   - A modal will appear showing your calendar
   - Click on any day to select it as the destination
   - Confirm your selection

3. **Handle Conflicts:**
   - If the target day has existing events, you'll see conflict options:
     - **Skip:** Don't copy conflicting events
     - **Copy Anyway:** Create duplicates (may overlap)
     - **Overwrite:** Replace existing events with copied ones

4. **Review Results:**
   - See a summary of what was copied
   - View any errors or conflicts
   - Option to export the results

**Perfect for:**
- Setting up recurring weekly schedules
- Copying template days to new weeks
- Bulk scheduling for similar days

---

### 📋 Bulk Operations

**What it does:** Select specific events from multiple days and copy them all at once

**How to use:**
1. **Enable Selection Mode:**
   - Checkboxes appear on all events when you hover
   - Click checkboxes to select events you want to copy

2. **Choose Target Date:**
   - A **"Copy Selected To..."** button appears in the calendar header
   - Click it to open the date picker
   - Select your target date

3. **Monitor Progress:**
   - Real-time progress bar shows copying status
   - See success/failure counts
   - Pause or cancel if needed

4. **Review Results:**
   - Detailed summary of the operation
   - Export results for your records

**Perfect for:**
- Copying important meetings to project weeks
- Setting up events across multiple calendars
- Batch scheduling for recurring projects

---

### ⏱️ Quick Duration Controls

**What it does:** Instantly adjust event duration without opening the full editor

**How to use:**
1. **Open Event Details:**
   - Click on any event to open the details popup
   - Look for the **"Quick Adjust"** section

2. **Use Quick Buttons:**
   - **+15m, +30m, +60m:** Add time to the event
   - **-15m:** Remove time from the event (where available)
   - **Fill Until Next:** Extend until your next event starts

3. **Automatic Saving:**
   - Changes save instantly
   - No need to click additional save buttons
   - Conflicts are automatically prevented

**Perfect for:**
- Extending meetings that run long
- Creating buffer time between events
- Quick scheduling adjustments

## Troubleshooting

### Common Issues

**❌ Extension not showing in Google Calendar**
- ✅ Refresh the Google Calendar page
- ✅ Check that the extension is enabled in `chrome://extensions/`
- ✅ Try opening Google Calendar in an incognito window

**❌ Copy operations are very slow**
- ✅ This is normal without API setup - the extension uses fallback methods
- ✅ Consider setting up Google Calendar API for faster operations
- ✅ Close other browser tabs to free up resources

**❌ Authentication errors**
- ✅ Sign out and back into Google Calendar
- ✅ Check your Google account permissions
- ✅ Try refreshing the page

**❌ Events not copying correctly**
- ✅ Ensure you have edit permissions for the target calendar
- ✅ Check if the target day has calendar restrictions
- ✅ Try copying fewer events at once

### Getting Help

1. **Check the Console:**
   - Press F12 in Chrome
   - Look for `[GCT]` prefixed messages
   - Share error messages when reporting issues

2. **Performance Issues:**
   - The extension includes built-in performance monitoring
   - Large operations (100+ events) may take several minutes without API setup
   - Use the progress indicators to monitor operations

3. **Report Issues:**
   - Include your Chrome version
   - Describe the specific steps that led to the issue
   - Share any error messages from the console

## Privacy & Security

### Data Handling

- **No Data Collection:** The extension doesn't send your calendar data to external servers
- **Direct API Calls:** All communication is directly with Google's servers
- **Local Storage:** Settings and cache are stored locally in your browser
- **Open Source:** The code is available for review and audit

### Permissions Explained

- **Google Calendar Access:** Required to read and modify your calendar events
- **Storage:** Used for extension settings and performance optimization
- **Identity:** Needed for Google API authentication (optional feature)

### Security Best Practices

- Only grant permissions when prompted
- Regularly review your Google account permissions
- Keep the extension updated
- Report any suspicious behavior immediately

## FAQ

**Q: Does this work with all types of Google Calendars?**
A: Yes, it works with personal calendars, shared calendars, and Google Workspace calendars (if you have edit permissions).

**Q: Can I undo operations?**
A: Currently, undo isn't supported. However, operations show detailed results so you can manually revert changes if needed.

**Q: Will this slow down Google Calendar?**
A: The extension is designed for minimal performance impact. It only activates on Google Calendar pages and uses efficient processing methods.

**Q: Does it work offline?**
A: No, the extension requires an internet connection to interact with Google Calendar.

**Q: Can I suggest new features?**
A: Yes! Feature requests are welcome. Consider the extension's focus on productivity and ease of use.

**Q: Is there a mobile version?**
A: This is a Chrome extension for desktop browsers. Mobile browser support varies, but the extension is optimized for desktop use.

**Q: How often is the extension updated?**
A: Updates are released as needed for bug fixes, Google Calendar compatibility, and new features.

---

**Need more help?** Check the [README.md](README.md) for technical details or report issues through the appropriate channels.

**Enjoying the extension?** Consider leaving a review and sharing it with colleagues who might benefit from enhanced calendar productivity! 