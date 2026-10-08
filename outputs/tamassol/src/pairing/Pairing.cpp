#include "Pairing.h"
#include <Arduino.h>
#include <Preferences.h>
#include <esp_system.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <mbedtls/ecdsa.h>
#include <mbedtls/sha256.h>
#include <cstring>
#include <atomic>

namespace tamassol {
namespace {
struct Command { bool physical=false; uint32_t generation=0; char text[192]{}; };
QueueHandle_t commands=nullptr, views=nullptr;
PairingState state;
Preferences prefs;
bool storage=false;
std::atomic<bool> pendingUi{false};
uint32_t generation=0;
uint8_t peer[65]{}, candidate[65]{}, nonce[32]{};
// This public key is an independent device-link key, NEVER a Solana wallet key.
constexpr char kDomain[]="TAMASSOL-LINK-v1:";

int nibble(char c) {
  if(c>='0'&&c<='9') return c-'0';
  if(c>='a'&&c<='f') return c-'a'+10;
  return -1;
}
bool decode(const char* text, uint8_t* out, size_t size) {
  if(strlen(text)!=size*2) return false;
  for(size_t i=0;i<size;++i) {
    const int hi=nibble(text[i*2]),lo=nibble(text[i*2+1]);
    if(hi<0||lo<0) return false;
    out[i]=uint8_t((hi<<4)|lo);
  }
  return true;
}
void encode(const uint8_t* bytes,size_t size,char* out) {
  constexpr char digits[]="0123456789abcdef";
  for(size_t i=0;i<size;++i){out[2*i]=digits[bytes[i]>>4];out[2*i+1]=digits[bytes[i]&15];}
  out[size*2]=0;
}
bool loadKey(mbedtls_ecdsa_context& key,const uint8_t* raw) {
  return raw[0]==4 && mbedtls_ecp_group_load(&key.grp,MBEDTLS_ECP_DP_SECP256R1)==0 &&
    mbedtls_ecp_point_read_binary(&key.grp,&key.Q,raw,65)==0 &&
    mbedtls_ecp_check_pubkey(&key.grp,&key.Q)==0;
}
bool validKey(const uint8_t* raw) {
  mbedtls_ecdsa_context key; mbedtls_ecdsa_init(&key);
  const bool ok=loadKey(key,raw); mbedtls_ecdsa_free(&key); return ok;
}
void fingerprint(const uint8_t* raw,char* out) {
  uint8_t hash[32]; mbedtls_sha256_ret(raw,65,hash,0); encode(hash,8,out);
}
PairingView snapshot() {
  PairingView v; v.available=storage; v.bound=state.bound(); v.online=state.online();
  v.pending=state.pending();
  v.generation=generation;
  if(v.pending==PairingState::Pending::Bind) fingerprint(candidate,v.fingerprint);
  else if(v.bound) fingerprint(peer,v.fingerprint);
  return v;
}
void publish() {
  const PairingView v=snapshot();
  pendingUi.store(v.pending!=PairingState::Pending::None);
  xQueueOverwrite(views,&v);
}
void status() {
  const auto v=snapshot();
  Serial.printf("@PAIR STATUS %s %s %s\n", !storage?"unavailable":
    v.pending==PairingState::Pending::Bind?"pending":
    v.pending==PairingState::Pending::Forget?"forget":
    v.online?"online":v.bound?"offline":"unpaired",v.fingerprint,"usb-only");
}
bool verify(const char* signature) {
  const size_t length=strlen(signature);
  if(length<16 || length>144 || length%2) return false;
  uint8_t der[72],message[sizeof(kDomain)-1+32],hash[32];
  if(!decode(signature,der,length/2)) return false;
  memcpy(message,kDomain,sizeof(kDomain)-1); memcpy(message+sizeof(kDomain)-1,nonce,32);
  mbedtls_sha256_ret(message,sizeof(message),hash,0);
  mbedtls_ecdsa_context key; mbedtls_ecdsa_init(&key);
  const bool ok=loadKey(key,peer) &&
    mbedtls_ecdsa_read_signature(&key,hash,sizeof(hash),der,length/2)==0;
  mbedtls_ecdsa_free(&key); return ok;
}
void physical(uint32_t now) {
  if(!storage || !state.canConfirm(now)) { Serial.println("@PAIR ERROR not_ready"); return; }
  const bool bind=state.pending()==PairingState::Pending::Bind;
  uint8_t record[66]{}; record[0]=bind?1:0;
  if(bind) memcpy(record+1,candidate,65);
  // One NVS blob commits identity atomically. Tombstone permits idempotent revocation.
  if(prefs.putBytes("peer",record,sizeof(record))!=sizeof(record)) {
    state.cancel(); Serial.println("@PAIR ERROR storage"); return;
  }
  memcpy(peer,record+1,65); memset(candidate,0,sizeof(candidate));
  state.committed(); Serial.println(bind?"@PAIR BOUND":"@PAIR FORGOTTEN");
}
void process(const char* cmd,uint32_t now) {
  if(strcmp(cmd,"PAIR STATUS")==0) {status();return;}
  if(!storage) {Serial.println("@PAIR ERROR storage");return;}
  if(strncmp(cmd,"PAIR REQUEST ",13)==0) {
    uint8_t raw[65];
    if(!decode(cmd+13,raw,65)||!validKey(raw)) {Serial.println("@PAIR ERROR public_key");return;}
    if(!state.request(false,now)) {Serial.println("@PAIR ERROR already_bound_or_pending");return;}
    ++generation;
    memcpy(candidate,raw,65); char fp[17]; fingerprint(raw,fp);
    Serial.printf("@PAIR PENDING %s 60\n",fp);
  } else if(strcmp(cmd,"PAIR FORGET")==0) {
    if(!state.request(true,now)) Serial.println("@PAIR ERROR not_bound_or_pending");
    else {++generation; Serial.println("@PAIR FORGET_PENDING 60");}
  } else if(strcmp(cmd,"PAIR CANCEL")==0) {
    state.cancel(); memset(candidate,0,sizeof(candidate)); Serial.println("@PAIR CANCELLED");
  } else if(strcmp(cmd,"PAIR CHALLENGE")==0) {
    if(!state.challenge(now)) {Serial.println("@PAIR ERROR challenge_denied");return;}
    esp_fill_random(nonce,sizeof(nonce)); char hex[65]; encode(nonce,32,hex);
    Serial.printf("@PAIR CHALLENGE %s\n",hex);
  } else if(strncmp(cmd,"PAIR PROOF ",11)==0) {
    const bool ok=state.hasNonce(now) && verify(cmd+11);
    const bool accepted=state.proof(ok,millis());
    memset(nonce,0,sizeof(nonce));
    Serial.println(accepted?"@PAIR AUTHENTICATED":"@PAIR ERROR proof");
  } else Serial.println("@PAIR ERROR unknown_command");
}
void worker(void*) {
  storage=prefs.begin("tama-link",false);
  uint8_t record[66]{};
  if(storage && prefs.isKey("peer")) {
    if(prefs.getBytesLength("peer")!=sizeof(record) ||
       prefs.getBytes("peer",record,sizeof(record))!=sizeof(record) ||
       record[0]>1 || (record[0]==1&&!validKey(record+1))) storage=false; // fail closed
  }
  const bool bound=storage&&record[0]==1;
  if(bound) memcpy(peer,record+1,65);
  state.begin(bound); publish(); status();
  for(;;) {
    Command c;
    if(xQueueReceive(commands,&c,pdMS_TO_TICKS(50))==pdTRUE) {
      state.tick(millis());
      if(c.physical) {
        const auto v=snapshot();
        if(c.generation==v.generation && c.text[0]==static_cast<char>('0'+static_cast<int>(v.pending)) &&
           strcmp(c.text+1,v.fingerprint)==0) physical(millis());
        else Serial.println("@PAIR ERROR stale_confirmation");
      } else process(c.text,millis());
    }
    if(!Serial) state.disconnect();
    state.tick(millis()); publish();
  }
}
}
void beginPairing() {
  commands=xQueueCreate(3,sizeof(Command)); views=xQueueCreate(1,sizeof(PairingView));
  if(!commands || !views || xTaskCreatePinnedToCore(worker,"tama-link",6144,nullptr,1,nullptr,0)!=pdPASS) {
    if(commands) vQueueDelete(commands);
    if(views) vQueueDelete(views);
    commands=views=nullptr; Serial.println("@PAIR ERROR allocation");
  }
}
bool pairingCommand(const char* cmd) {
  if(strncmp(cmd,"PAIR ",5)!=0) return false;
  Command c;
  if(!commands || strlen(cmd)>=sizeof(c.text)) {Serial.println("@PAIR ERROR unavailable");return true;}
  strcpy(c.text,cmd);
  if(xQueueSend(commands,&c,0)!=pdTRUE) Serial.println("@PAIR ERROR busy");
  return true;
}
bool pollPairing(PairingView& view) {return views&&xQueueReceive(views,&view,0)==pdTRUE;}
void confirmPairing(const PairingView& shown) {
  Command c; c.physical=true;
  c.generation=shown.generation;
  c.text[0]=static_cast<char>('0'+static_cast<int>(shown.pending));
  strcpy(c.text+1,shown.fingerprint);
  if(commands && xQueueSend(commands,&c,0)!=pdTRUE) Serial.println("@PAIR ERROR busy");
}
bool pairingPending() {return pendingUi.load() || (commands&&uxQueueMessagesWaiting(commands)>0);}
} // namespace tamassol
