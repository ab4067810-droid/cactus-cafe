# Cactus Cafe Website - Starter Guide

Welcome! Your Cactus Cafe website has been reset and is ready for you to build upon. Here's a simple guide to help you understand the project structure.

## 📁 Project Structure

```
Cactus-Cafe-Website/
├── src/
│   ├── components/          # Reusable parts of the website
│   │   └── Navigation.jsx   # The top navigation bar
│   │
│   ├── pages/               # Full pages of the website
│   │   ├── HomePage.jsx     # Welcome/home page
│   │   ├── MenuPage.jsx     # Menu page (coming soon)
│   │   ├── AboutPage.jsx    # About page (coming soon)
│   │   └── Login.jsx        # Login page
│   │
│   ├── routes/              # URL routing setup
│   │   └── AppRoutes.jsx    # Defines which page shows for each URL
│   │
│   ├── services/            # Helper functions
│   │   ├── firebase.jsx     # Firebase configuration (needs your details!)
│   │   └── authService.jsx  # Functions for login
│   │
│   ├── context/             # Shared data across components
│   │   └── Authcontext.jsx  # Tracks if user is logged in
│   │
│   ├── styles/              # CSS styling
│   │   ├── index.css        # General website styles
│   │   ├── App.css          # App layout styles
│   │   ├── Navigation.css   # Top bar styling
│   │   ├── HomePage.css     # Home page styling
│   │   └── Login.css        # Login page styling
│   │
│   ├── App.jsx              # Main app component
│   └── main.jsx             # App entry point
│
├── public/                  # Static files (images, etc.)
├── package.json             # Project dependencies
└── vite.config.js           # Build configuration
```

## 🎨 Cactus Cafe Colors

The website uses a clean, professional green and white design:

- **Cactus Green**: `#2d5016` - Main brand color, navigation, buttons
- **White**: `#ffffff` - Clean background
- **Light Gray**: `#f9f9f9` - Subtle background accents
- **Dark Text**: `#333333` - Readable body text
- **Medium Gray**: `#666666` - Secondary text

This creates a fresh, modern, professional look perfect for a cafe business.

## 📄 Important Files Explained

### **Firebase Configuration** (`src/services/firebase.jsx`)
This file connects your app to Firebase for user authentication. 
**YOU NEED TO:** Replace the placeholder values with your Firebase project details.

How to get your Firebase config:
1. Go to https://console.firebase.google.com
2. Create a new project or select an existing one
3. Click "Web" to add a web app
4. Copy your Firebase config
5. Paste it into this file

### **App Routes** (`src/routes/AppRoutes.jsx`)
This file defines which page appears for each URL:
- `/` → HomePage
- `/menu` → MenuPage
- `/about` → AboutPage
- `/login` → Login page

### **Login Page** (`src/pages/Login.jsx`)
A simple form for users to sign in with email and password.
It currently just validates the form and calls Firebase login.

### **Home Page** (`src/pages/HomePage.jsx`)
The welcome page that greets visitors to your cafe.

## 🚀 Getting Started

### 1. **Set up Firebase**
First, add your Firebase project details to `src/services/firebase.jsx`

### 2. **Run the website**
```bash
npm run dev
```
This starts a local server at http://127.0.0.1:5174/

### 3. **Build for deployment**
```bash
npm run build
```
This creates a production-ready version in the `dist/` folder

## 🛠️ Next Steps

After the starter website works, you can:

1. **Add Menu Items** - Update `MenuPage.jsx` to show your cafe menu
2. **Add About Content** - Update `AboutPage.jsx` to tell your story
3. **Improve Login** - Later, you can add more login options
4. **Add More Pages** - Create new pages and add them to AppRoutes.jsx
5. **Add Features** - Build ordering, cart, etc. step by step

## 📚 Resources

- [React Docs](https://react.dev)
- [Firebase Docs](https://firebase.google.com/docs)
- [React Router Docs](https://reactrouter.com)
- [Vite Docs](https://vitejs.dev)

## ✨ What Was Removed

All the old voting system code has been deleted:
- Admin dashboard pages
- Voting pages
- Admin layout and routes
- Old services and styles

Your project is now clean and ready to build your cafe website! 🌵☕
