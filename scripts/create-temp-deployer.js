const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

function main() {
  const tempWalletPath = path.join(__dirname, "..", ".temp-deployer.json");

  let wallet;
  if (fs.existsSync(tempWalletPath)) {
    const existing = JSON.parse(fs.readFileSync(tempWalletPath, "utf8"));
    wallet = new ethers.Wallet(existing.privateKey);
    console.log("Using existing temporary deployment wallet.");
  } else {
    wallet = ethers.Wallet.createRandom();
    const data = {
      address: wallet.address,
      privateKey: wallet.privateKey,
      network: "MST Blockchain Testnet",
      chainId: 91562037,
      createdAt: new Date().toISOString(),
      warning: "THIS IS A TEMPORARY TESTNET-ONLY WALLET. NEVER USE FOR REAL FUNDS OR MAINNET."
    };
    fs.writeFileSync(tempWalletPath, JSON.stringify(data, null, 2));
    console.log("Created NEW temporary deployment wallet.");
  }

  console.log("============================================================");
  console.log("  SWARMMIND TEMPORARY TESTNET DEPLOYER WALLET               ");
  console.log("============================================================");
  console.log(`Public Address : ${wallet.address}`);
  console.log(`Chain ID       : 91562037 (MST Testnet)`);
  console.log(`RPC Endpoint   : https://testnetrpc.mstblockchain.com`);
  console.log("------------------------------------------------------------");
  console.log("INSTRUCTIONS:");
  console.log("1. From your BridgeKey wallet, send a small amount of testnet");
  console.log(`   tokens (e.g. 0.05 - 0.1 tMSTC) to:`);
  console.log(`   --> ${wallet.address}`);
  console.log("2. Run the deployment command:");
  console.log("   --> npm run deploy:temp");
  console.log("3. Your primary BridgeKey private key remains 100% untouched.");
  console.log("============================================================");
}

main();
