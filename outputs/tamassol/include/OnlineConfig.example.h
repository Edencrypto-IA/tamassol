#pragma once
// Copy to OnlineConfig.h locally. Never share configured headers or firmware.
#define WIFI_SSID "YOUR_2_4_GHZ_WIFI"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"
// Optional home network tried first; existing WIFI_SSID remains the fallback.
#define WIFI_HOME_SSID "YOUR_HOME_2_4_GHZ_WIFI"
#define WIFI_HOME_PASSWORD "YOUR_HOME_WIFI_PASSWORD"
#define SOLANA_WALLET_ADDRESS "YOUR_DEVNET_PUBLIC_ADDRESS"
#define SOLANA_RPC "https://api.devnet.solana.com"
// Use a separate namespace for a new wallet; never erase the previous wallet history.
#define SOLANA_NVS_NAMESPACE "tamassol-dev"
