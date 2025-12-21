import { supabase } from "./supabase.js";

console.log("Dashboard JS loaded");

// 🔒 Protect page
const { data } = await supabase.auth.getSession();

if (!data.session) {
  window.location.replace("/");
}

// 🔓 Logout
const logoutBtn = document.getElementById("logoutBtn");

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    console.log("Logout clicked");

    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error("Logout error:", error.message);
      alert("Logout failed");
      return;
    }

    // ✅ FORCE redirect
    window.location.replace("/");
  });
} else {
  console.error("Logout button not found");
}
