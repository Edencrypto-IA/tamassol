#include "Online.h"
#include "Deposit.h"
#include "OnlineConfig.h"
#include "OnlineRoots.h"
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <Preferences.h>
#include <esp_heap_caps.h>
#include <time.h>
#include <vector>
#include <cmath>

#ifndef SOLANA_NVS_NAMESPACE
#define SOLANA_NVS_NAMESPACE "tamassol-dev"
#endif
static_assert(sizeof(SOLANA_NVS_NAMESPACE)>1 && sizeof(SOLANA_NVS_NAMESPACE)<=16,
              "NVS namespace must contain 1..15 characters");

namespace tamassol {
namespace {
struct WifiNetwork { const char* ssid; const char* password; };
constexpr WifiNetwork kWifiNetworks[] = {
#if defined(WIFI_HOME_SSID) && defined(WIFI_HOME_PASSWORD)
  {WIFI_HOME_SSID,WIFI_HOME_PASSWORD},
#endif
  {WIFI_SSID,WIFI_PASSWORD}
};
constexpr size_t kWifiNetworkCount=sizeof(kWifiNetworks)/sizeof(kWifiNetworks[0]);
// One atomic NVS blob: a power loss cannot separate count from checkpoint.
struct Saved {
  uint32_t version = 1;
  uint32_t spark_count = 0;
  int64_t last_deposit_time = 0;
  char last_signature[89] = {};
  char wallet[45] = {};
  bool initialized = false;
};
struct PsramAllocator {
  void* allocate(size_t n) { return heap_caps_malloc(n, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT); }
  void deallocate(void* p) { heap_caps_free(p); }
  void* reallocate(void* p, size_t n) { return heap_caps_realloc(p,n,MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT); }
};
using Document = BasicJsonDocument<PsramAllocator>;
constexpr char kDevnet[] = "https://api.devnet.solana.com";
constexpr char kPrice[] = "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd&include_24hr_change=true";
class ResponseBuffer : public Stream {
 public:
  static constexpr size_t limit=262144;
  uint8_t* data=static_cast<uint8_t*>(heap_caps_malloc(limit,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT));
  size_t length=0;
  ~ResponseBuffer() { heap_caps_free(data); }
  size_t write(uint8_t b) override { return write(&b,1); }
  size_t write(const uint8_t* p,size_t n) override {
    if (!data || n>limit-length) return 0;
    memcpy(data+length,p,n); length+=n; return n;
  }
  int available() override { return 0; }
  int read() override { return -1; }
  int peek() override { return -1; }
  void flush() override {}
};
bool request(const char* url, const String& body, Document& doc) {
  WiFiClientSecure tls;
  tls.setCACert(kOnlineRoots);
  tls.setHandshakeTimeout(8);
  tls.setTimeout(6000);
  HTTPClient http;
  http.useHTTP10(false); // CoinGecko rejects HTTP/1.0. HTTPClient decodes chunked below.
  http.setConnectTimeout(6000);
  http.setTimeout(6000);
  if (!http.begin(tls,url)) return false;
  int status;
  if (body.length()) {
    http.addHeader("Content-Type","application/json");
    status = http.POST(body);
  } else status = http.GET();
  bool ok = false;
  if (status == 200 && http.getSize() <= 262144) {
    ResponseBuffer buffer;
    int received=buffer.data?http.writeToStream(&buffer):-1;
    if (received<0 || !buffer.length) {
      Serial.println("ONLINE response incomplete/oversized; retaining previous data");
      http.end(); return false;
    }
    doc.clear();
    // Read-only input ensures JSON owns its strings after the temporary buffer is freed.
    auto error = deserializeJson(doc,static_cast<const uint8_t*>(buffer.data),buffer.length);
    ok = !error && !doc.overflowed() && doc["error"].isNull();
    if (!ok) Serial.printf("ONLINE JSON/RPC unavailable: %s\n",error.c_str());
  } else Serial.printf("ONLINE %s HTTP=%d; retaining previous data\n",body.length()?"DEVNET":"PRICE",status);
  http.end();
  return ok;
}
bool rpc(const char* method, const String& params, Document& doc) {
  // Fail closed: configuration cannot route this firmware to Mainnet.
  if (strcmp(SOLANA_RPC,kDevnet)) return false;
  return request(kDevnet,String("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"")+method+"\",\"params\":"+params+"}",doc);
}
bool save(Preferences& nvs, const Saved& next, Saved& current) {
  if (nvs.putBytes("state",&next,sizeof(next)) != sizeof(next)) {
    Serial.println("ONLINE NVS failed; checkpoint not advanced"); return false;
  }
  current = next;
  return true;
}
bool walletValid() {
  const char* w = SOLANA_WALLET_ADDRESS;
  const size_t n = strlen(w);
  if (n < 32 || n > 44) return false;
  for (size_t i=0;i<n;++i)
    if (!strchr("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz",w[i])) return false;
  return true;
}
String signatures(const String& before, unsigned limit) {
  String p = String("[\"")+SOLANA_WALLET_ADDRESS+"\",{\"commitment\":\"finalized\",\"limit\":"+limit;
  if (before.length()) p += ",\"before\":\""+before+"\"";
  return p+"}]";
}
bool scan(Preferences& nvs, Saved& state, Document& doc, QueueHandle_t queue) {
  if (!state.initialized) {
    if (!rpc("getSignaturesForAddress",signatures("",1),doc) || !doc["result"].is<JsonArray>()) return false;
    Saved next = state;
    strlcpy(next.last_signature,doc["result"][0]["signature"] | "",sizeof(next.last_signature));
    next.initialized = true;
    // First synchronization is a baseline, never reward old account history.
    bool ok=save(nvs,next,state);
    if (ok) Serial.println("DEVNET baseline saved; watching NEW deposits only");
    return ok;
  }
  std::vector<String> pending;
  String before;
  bool reached = false;
  while (!reached) {
    if (!rpc("getSignaturesForAddress",signatures(before,32),doc) || !doc["result"].is<JsonArray>()) return false;
    JsonArray list = doc["result"].as<JsonArray>();
    for (JsonObject row : list) {
      const char* sig = row["signature"] | "";
      if (!*sig || strlen(sig)>88) return false;
      if (!strcmp(sig,state.last_signature)) { reached = true; break; }
      if (pending.size() >= 512) {
        Serial.println("ONLINE history exceeds safety bound; checkpoint preserved"); return false;
      }
      pending.emplace_back(sig);
    }
    if (list.size()<32 && !reached) {
      // Missing checkpoint means pruned/reset history: do not replay or silently skip.
      if (*state.last_signature) { Serial.println("ONLINE history gap; checkpoint preserved"); return false; }
      reached = true;
    }
    if (!reached) before = pending.back();
    vTaskDelay(pdMS_TO_TICKS(350));
  }
  for (auto it=pending.rbegin();it!=pending.rend();++it) {
    if (!rpc("getTransaction",String("[\"")+*it+"\",{\"commitment\":\"finalized\",\"encoding\":\"jsonParsed\",\"maxSupportedTransactionVersion\":0}]",doc)) return false;
    JsonObject tx = doc["result"].as<JsonObject>();
    uint64_t amount = 0;
    if (!depositAmount(tx,SOLANA_WALLET_ADDRESS,amount)) return false;
    Saved next=state;
    strlcpy(next.last_signature,it->c_str(),sizeof(next.last_signature));
    if (amount) {
      if (next.spark_count==UINT32_MAX) return false;
      ++next.spark_count;
      next.last_deposit_time=tx["blockTime"] | int64_t(0);
    }
    if (!save(nvs,next,state)) return false;
    if (amount) {
      OnlineEvent event{}; event.kind=OnlineEvent::Deposit; event.lamports=amount; event.sparks=state.spark_count;
      // Backpressure only in the network worker. UI never waits for HTTP or NVS.
      xQueueSend(queue,&event,portMAX_DELAY);
      Serial.printf("DEVNET deposit=%llu lamports spark_count=%u\n",amount,state.spark_count);
    }
    vTaskDelay(pdMS_TO_TICKS(350));
  }
  return true;
}
}
void Online::begin() {
  queue_=xQueueCreate(8,sizeof(OnlineEvent));
  if (!queue_) { Serial.println("ONLINE queue allocation failed"); return; }
  if (xTaskCreatePinnedToCore(run,"tamassol-online",12288,this,1,nullptr,0)!=pdPASS) {
    vQueueDelete(queue_); queue_=nullptr; Serial.println("ONLINE task allocation failed");
  }
}
bool Online::poll(OnlineEvent& event) { return queue_ && xQueueReceive(queue_,&event,0)==pdTRUE; }
bool Online::connected() const { return WiFi.status()==WL_CONNECTED; }
void Online::run(void* self) {
  auto& online=*static_cast<Online*>(self);
  if (!walletValid() || strcmp(SOLANA_RPC,kDevnet)) { Serial.println("ONLINE invalid DEVNET configuration"); vTaskDelete(nullptr); return; }
  Preferences nvs;
  if (!nvs.begin(SOLANA_NVS_NAMESPACE,false)) { Serial.println("ONLINE NVS unavailable"); vTaskDelete(nullptr); return; }
  Saved state;
  size_t bytes=nvs.getBytesLength("state");
  if (bytes) {
    if (bytes!=sizeof(state) || nvs.getBytes("state",&state,sizeof(state))!=sizeof(state) || state.version!=1 || !memchr(state.wallet,0,sizeof(state.wallet)) || !memchr(state.last_signature,0,sizeof(state.last_signature))) {
      Serial.println("ONLINE invalid saved state; stopped safely"); vTaskDelete(nullptr); return;
    }
    if (strcmp(state.wallet,SOLANA_WALLET_ADDRESS)) { Serial.println("ONLINE wallet differs from saved state; stopped safely"); vTaskDelete(nullptr); return; }
  } else strlcpy(state.wallet,SOLANA_WALLET_ADDRESS,sizeof(state.wallet));
  Serial.printf("DEVNET saved spark_count=%u checkpoint=%s\n",state.spark_count,state.initialized?"ready":"first sync");
  Document doc(196608);
  if (!doc.capacity()) { Serial.println("ONLINE PSRAM allocation failed"); vTaskDelete(nullptr); return; }
  WiFi.persistent(false);
  WiFi.onEvent([](WiFiEvent_t event, WiFiEventInfo_t info) {
    if (event==ARDUINO_EVENT_WIFI_STA_DISCONNECTED)
      Serial.printf("ONLINE Wi-Fi disconnect reason=%u\n",info.wifi_sta_disconnected.reason);
  });
  WiFi.mode(WIFI_STA);
  // One owner of retries: rotate saved networks without blocking the UI task.
  WiFi.setAutoReconnect(false);
  size_t wifiNetwork=0;
  WiFi.begin(kWifiNetworks[wifiNetwork].ssid,kWifiNetworks[wifiNetwork].password);
  configTime(0,0,"pool.ntp.org","time.google.com");
  uint32_t lastConnect=millis(), lastPrice=millis()-300000U, lastRpc=millis()-30000U, lastStatus=0;
  uint32_t priceInterval=60000U;
  bool connected=false, verified=false;
  for (;;) {
    uint32_t now=millis();
    if (now-lastStatus>=15000U) {
      Serial.printf("ONLINE wifi_status=%d clock=%s devnet=%s spark_count=%u checkpoint=%s\n",
        int(WiFi.status()),time(nullptr)>1700000000?"ready":"waiting",verified?"verified":"waiting",
        state.spark_count,state.initialized?"ready":"first-sync");
      lastStatus=now;
    }
    if (WiFi.status()!=WL_CONNECTED) {
      if (connected) {
        Serial.println("ONLINE Wi-Fi disconnected; animation continues");
        lastConnect=now-15000U; // Start the next saved network immediately after a loss.
      }
      connected=false; verified=false;
      online.verified_.store(false);
      if (now-lastConnect>=15000U) {
        wifiNetwork=(wifiNetwork+1)%kWifiNetworkCount;
        WiFi.disconnect(false,false); // Keep radio on; never erase NVS.
        WiFi.begin(kWifiNetworks[wifiNetwork].ssid,kWifiNetworks[wifiNetwork].password);
        lastConnect=now;
      }
    } else {
      if (!connected) {
        Serial.printf("ONLINE Wi-Fi connected SSID=%s; waiting for verified HTTPS\n",WiFi.SSID().c_str());
        connected=true;
      }
      if (time(nullptr)>1700000000) {
        if (now-lastPrice>=priceInterval) {
          lastPrice=now;
          priceInterval=60000U; // Bounded retry; leave the last valid quote on screen.
          if (request(kPrice,"",doc) && doc["solana"]["usd"].is<double>() && doc["solana"]["usd_24h_change"].is<double>()) {
            double price=doc["solana"]["usd"].as<double>();
            double change=doc["solana"]["usd_24h_change"].as<double>();
            if (std::isfinite(price) && price>0 && price<1000000 && std::isfinite(change)) {
              OnlineEvent event{}; event.kind=OnlineEvent::Price; event.price=price;
              event.change24h=change;
              event.receivedAt=millis();
              xQueueSend(online.queue_,&event,portMAX_DELAY);
              priceInterval=300000U;
              Serial.printf("ONLINE SOL/USD=%.2f change24h=%+.2f%%\n",price,change);
            }
          }
        }
        if (now-lastRpc>=30000U) {
          lastRpc=now;
          if (!verified && rpc("getGenesisHash","[]",doc)) {
            verified=!strcmp(doc["result"] | "","EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");
            online.verified_.store(verified);
            Serial.printf("DEVNET genesis=%s\n",verified?"verified":"REJECTED");
          }
          if (verified) {
            if (rpc("getBalance",String("[\"")+SOLANA_WALLET_ADDRESS+"\",{\"commitment\":\"finalized\"}]",doc) && doc["result"]["value"].is<uint64_t>()) {
              Serial.printf("DEVNET balance=%llu lamports\n",doc["result"]["value"].as<uint64_t>());
              OnlineEvent event{}; event.kind=OnlineEvent::Balance;
              event.lamports=doc["result"]["value"].as<uint64_t>();
              event.receivedAt=millis();
              xQueueSend(online.queue_,&event,portMAX_DELAY);
            }
            scan(nvs,state,doc,online.queue_);
          }
        }
      }
    }
    vTaskDelay(pdMS_TO_TICKS(100));
  }
}
}
