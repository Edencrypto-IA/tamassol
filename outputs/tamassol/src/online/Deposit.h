#pragma once
#include <ArduinoJson.h>
#include <cstdint>
#include <cstring>
namespace tamassol {
// jsonParsed includes resolved lookup-table addresses in accountKeys.
// Count one reward per successful transaction, including inner native transfers.
inline bool depositAmount(JsonObject tx, const char* wallet, uint64_t& amount) {
  amount=0;
  JsonObject meta=tx["meta"].as<JsonObject>();
  if (tx.isNull() || meta.isNull()) return false;
  if (!meta["err"].isNull()) return true;
  JsonArray keys=tx["transaction"]["message"]["accountKeys"].as<JsonArray>();
  JsonArray pre=meta["preBalances"].as<JsonArray>();
  JsonArray post=meta["postBalances"].as<JsonArray>();
  if (!keys.size() || pre.size()!=keys.size() || post.size()!=keys.size()) return false;
  bool found=false;
  for (size_t i=0;i<keys.size();++i) {
    if (strcmp(keys[i]["pubkey"] | "",wallet)) continue;
    found=true;
    if (!pre[i].is<uint64_t>() || !post[i].is<uint64_t>()) return false;
    uint64_t a=pre[i].as<uint64_t>(),b=post[i].as<uint64_t>();
    if (b>a) amount=b-a;
  }
  if (!found) return false;
  uint64_t incoming=0;
  auto transfers=[&](JsonArray list) {
    for (JsonObject ix:list) {
      if (strcmp(ix["programId"] | "","11111111111111111111111111111111")) continue;
      const char* type=ix["parsed"]["type"] | "";
      if (strcmp(type,"transfer") && strcmp(type,"transferWithSeed")) continue;
      JsonObject info=ix["parsed"]["info"];
      if (strcmp(info["destination"] | "",wallet) || !strcmp(info["source"] | "",wallet)) continue;
      if (!info["lamports"].is<uint64_t>()) return false;
      uint64_t value=info["lamports"].as<uint64_t>();
      if (UINT64_MAX-incoming<value) return false;
      incoming+=value;
    }
    return true;
  };
  if (!transfers(tx["transaction"]["message"]["instructions"].as<JsonArray>())) return false;
  for (JsonObject group:meta["innerInstructions"].as<JsonArray>())
    if (!transfers(group["instructions"].as<JsonArray>())) return false;
  // Also detect native credits from programs/airdrop even without parsed transfers.
  if (incoming) amount=incoming;
  return true;
}
}
