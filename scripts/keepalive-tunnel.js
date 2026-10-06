const { spawn } = require("child_process");

function startTunnel() {
  console.log("Starting SSH tunnel to localhost.run...");
  const child = spawn("ssh", [
    "-o", "StrictHostKeyChecking=no",
    "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=3",
    "-R", "80:localhost:3333",
    "nokey@localhost.run"
  ], { stdio: "inherit" });

  child.on("close", (code) => {
    console.log(`SSH tunnel closed with code ${code}. Reconnecting in 3 seconds...`);
    setTimeout(startTunnel, 3000);
  });

  child.on("error", (err) => {
    console.error("SSH error:", err.message);
    setTimeout(startTunnel, 3000);
  });
}

startTunnel();
