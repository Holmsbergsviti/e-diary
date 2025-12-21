import { supabase } from "./supabase.js";

// Check session
const { data: { session } } = await supabase.auth.getSession();

if (!session) {
  window.location.href = "/index.html";
}

// Logout
document.getElementById("logout").onclick = async () => {
  await supabase.auth.signOut();
  window.location.href = "/index.html";
};
