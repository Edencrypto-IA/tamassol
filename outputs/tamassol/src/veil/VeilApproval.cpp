#include "VeilApproval.h"
#include <ArduinoJson.h>
#include <Preferences.h>
#include <mbedtls/ecdsa.h>
#include <mbedtls/sha256.h>
#include <esp_system.h>

namespace tamassol { namespace {
Display* screen=nullptr;
Preferences prefs;
mbedtls_ecdsa_context key;
bool available=false,pending=false,paint=false,released=false;
uint32_t started=0;
String canonical,nonce,route,recipient,amount;
String usedNonce;
char publicHex[131]{},fingerprint[17]{};
int rng(void*,unsigned char* out,size_t n){esp_fill_random(out,n);return 0;}
void hex(const uint8_t* in,size_t n,char* out){const char* h="0123456789abcdef";for(size_t i=0;i<n;i++){out[2*i]=h[in[i]>>4];out[2*i+1]=h[in[i]&15];}out[2*n]=0;}
bool hexText(const String& x,size_t n){if(x.length()!=n)return false;for(char c:x)if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return false;return true;}
String field(const String& x){return String(x.length())+":"+x;}
String profile(JsonObject x,bool exposure){String out;for(const char* s:{"sender","recipient","asset","amount","history"})out+=field(x[s].as<String>());if(exposure)out+=field(x["note"].as<String>());return out;}
void finish(const char* reason){Serial.printf("@VEIL %s %s\n",reason,nonce.c_str());pending=false;canonical="";paint=false;}
bool eq(JsonVariant v,const char* s){return v.is<const char*>() && strcmp(v.as<const char*>(),s)==0;}
bool validRecipient(const String& s){if(!s.startsWith("solana:") || s.length()<39 || s.length()>51)return false;const char* alphabet="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";for(size_t i=7;i<s.length();i++)if(!strchr(alphabet,s[i]))return false;return true;}
}
void beginVeilApproval(Display& display){
 screen=&display;mbedtls_ecdsa_init(&key);
 if(!prefs.begin("veil-test",false))return;
 uint8_t raw[32]{};
 if(mbedtls_ecp_group_load(&key.grp,MBEDTLS_ECP_DP_SECP256R1)!=0)return;
 if(prefs.getBytesLength("approval-key")==32){
  prefs.getBytes("approval-key",raw,32);
  if(mbedtls_mpi_read_binary(&key.d,raw,32)!=0 || mbedtls_ecp_check_privkey(&key.grp,&key.d)!=0 || mbedtls_ecp_mul(&key.grp,&key.Q,&key.d,&key.grp.G,rng,nullptr)!=0){memset(raw,0,32);return;}
 }else{
  if(mbedtls_ecdsa_genkey(&key,MBEDTLS_ECP_DP_SECP256R1,rng,nullptr)!=0)return;
  if(mbedtls_mpi_write_binary(&key.d,raw,32)!=0 || prefs.putBytes("approval-key",raw,32)!=32){memset(raw,0,32);return;}
 }
 memset(raw,0,32);uint8_t pub[65],hash[32];size_t len=0;
 if(mbedtls_ecp_point_write_binary(&key.grp,&key.Q,MBEDTLS_ECP_PF_UNCOMPRESSED,&len,pub,65)!=0 || len!=65)return;
 hex(pub,65,publicHex);mbedtls_sha256_ret(pub,65,hash,0);hex(hash,8,fingerprint);
 usedNonce=prefs.getString("last-nonce","");available=true;
 Serial.printf("@VEIL READY %s software-wallet-signing\n",fingerprint);
}
bool veilActive(){return pending;}
void veilCommand(const char* command){
 if(strcmp(command,"VEIL STATUS")==0){Serial.printf("@VEIL STATUS %s %s %s\n",available?"ready":"unavailable",fingerprint,publicHex);return;}
 if(strcmp(command,"VEIL CANCEL")==0){if(pending)finish("CANCELLED");return;}
 if(pending){Serial.println("@VEIL ERROR busy");return;}
 if(!available || strncmp(command,"VEIL REQUEST ",13)!=0){Serial.println("@VEIL ERROR unavailable_or_command");return;}
 StaticJsonDocument<4096> doc;
 if(deserializeJson(doc,command+13)){Serial.println("@VEIL ERROR malformed");return;}
 JsonObject e=doc.as<JsonObject>();JsonObject p=e["requestedPrivacy"],v=e["selectedExposure"];
 recipient=e["recipientBinding"].as<String>();amount=e["amountBaseUnits"].as<String>();
 // Restricted Devnet test profile: no blind arbitrary payload signing.
 bool ok=e["version"].as<int>()==3 && eq(e["deviceProtocol"],"TAMASSOL_VEIL_APPROVAL_V3") && eq(e["network"],"devnet") && eq(e["operation"],"private_transfer") && eq(e["assetId"],"SOL") && eq(e["assetSymbol"],"SOL") && e["assetDecimals"].as<int>()==9 && amount=="1000000" && eq(e["feeBaseUnits"],"100000") && eq(e["selectedProviderId"],"helius-confidential-devnet") && eq(e["selectedProviderVersion"],"0.1.0-devnet") && validRecipient(recipient);
 for(const char* s:{"sender","recipient","history"})ok=ok && eq(p[s],"irrelevant");
 for(const char* s:{"asset","amount"})ok=ok && eq(p[s],"required") && eq(v[s],"hidden");
 ok=ok && eq(v["sender"],"public") && eq(v["recipient"],"public") && eq(v["history"],"unknown");
 for(const char* s:{"routePlanHash","intentHash","providerPlanCommitment"})ok=ok && hexText(e[s].as<String>(),64);
 ok=ok && hexText(e["requestId"].as<String>(),32) && hexText(e["nonce"].as<String>(),48);
 const uint64_t created=e["createdAtMs"].as<uint64_t>(),expires=e["expiresAtMs"].as<uint64_t>();
 ok=ok && created>0 && expires>created && expires-created<=600000 && v["note"].is<const char*>() && strlen(v["note"].as<const char*>())<=200;
 if(!ok){Serial.println("@VEIL ERROR policy");return;}
 nonce=e["nonce"].as<String>();if(nonce==usedNonce){Serial.println("@VEIL ERROR replay");return;}
 canonical="";
 for(const char* s:{"deviceProtocol","version","requestId","nonce","createdAtMs","expiresAtMs","network","operation","assetId","assetSymbol","assetDecimals","amountBaseUnits","recipientBinding"})canonical+=field(e[s].as<String>());
 canonical+=field(profile(p,false));
 for(const char* s:{"routePlanHash","intentHash","selectedProviderId","selectedProviderVersion","providerPlanCommitment"})canonical+=field(e[s].as<String>());
 canonical+=field(profile(v,true))+field(e["feeBaseUnits"].as<String>());
 route=e["routePlanHash"].as<String>();pending=true;paint=true;released=false;started=millis();
 Serial.printf("@VEIL PENDING %s %s\n",nonce.c_str(),route.c_str());
}
bool pollVeilApproval(InputEvent event){
 if(!pending)return false;
 if(paint){auto& t=screen->canvas();t.fillScreen(TFT_BLACK);t.setTextDatum(TL_DATUM);t.setTextSize(1);t.setTextColor(TFT_CYAN,TFT_BLACK);t.drawString("VEIL / DEVNET - TEST ONLY",8,6,2);t.setTextColor(TFT_WHITE,TFT_BLACK);t.drawString("Send 0.001 SOL / Helius",8,30,2);t.drawString("To:",8,53,1);String a=recipient.substring(7);t.drawString(a.substring(0,24),8,66,2);t.drawString(a.substring(24),8,84,2);t.drawString("Amount/asset hidden; people PUBLIC",8,108,1);t.drawString("Fee max 0.0001 SOL; PC signs tx",8,123,1);t.drawString("Route: "+route.substring(0,16),8,138,1);t.drawString("Device: "+String(fingerprint),8,152,1);t.setTextColor(TFT_YELLOW,TFT_BLACK);t.drawString("BOOT short: CANCEL",8,172,2);t.drawString("BOOT hold + release: APPROVE",8,195,2);paint=false;}
 if(millis()-started>=90000){finish("EXPIRED");return false;}
 if(!released){if(digitalRead(0)==HIGH && millis()-started>300)released=true;return true;}
 if(event==InputEvent::Next){finish("CANCELLED");return false;}
 if(event==InputEvent::Voice){
  // Persist consumption before producing a signature. Reboot fails closed.
  if(prefs.putString("last-nonce",nonce)!=nonce.length()){finish("STORAGE_ERROR");return false;}
  usedNonce=nonce;uint8_t hash[32],sig[64];char out[129];
  mbedtls_sha256_ret(reinterpret_cast<const unsigned char*>(canonical.c_str()),canonical.length(),hash,0);
  mbedtls_mpi r,s;mbedtls_mpi_init(&r);mbedtls_mpi_init(&s);
  int rc=mbedtls_ecdsa_sign(&key.grp,&r,&s,&key.d,hash,32,rng,nullptr);
  if(!rc)rc=mbedtls_mpi_write_binary(&r,sig,32);if(!rc)rc=mbedtls_mpi_write_binary(&s,sig+32,32);
  mbedtls_mpi_free(&r);mbedtls_mpi_free(&s);
  if(rc){finish("SIGN_ERROR");return false;}
  hex(sig,64,out);Serial.printf("@VEIL APPROVED %s %s %s %s\n",nonce.c_str(),route.c_str(),fingerprint,out);pending=false;canonical="";return false;
 }
 return true;
}
}
