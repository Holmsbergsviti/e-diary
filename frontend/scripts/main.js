const email = document.getElementById("username").value;
const password = document.getElementById("password").value;

const { data, error } = await supabase.auth.signInWithPassword({
  email,
  password
});

if (error) {
  alert("Wrong credentials ❌");
} else {
  alert("Login successful ✅");
  console.log("SESSION:", data.session);
}
