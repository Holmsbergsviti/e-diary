// Theme loader - runs immediately to prevent flash of unstyled theme
(function() {
    const savedTheme = localStorage.getItem("selectedTheme") || "bright-blue";
    const themeMap = {
        "bright-blue": "",
        "ocean": "ocean",
        "purple": "purple",
        "emerald": "emerald",
        "rose": "rose",
        "amber": "amber",
        "indigo": "indigo"
    };
    
    const themeAttr = themeMap[savedTheme] || "";
    if (themeAttr) {
        document.documentElement.setAttribute("data-theme", themeAttr);
    }
})();
