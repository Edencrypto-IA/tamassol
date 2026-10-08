#include <cassert>
#include <iostream>
#include "online/Deposit.h"
using namespace tamassol;
int main() {
  DynamicJsonDocument doc(16384);
  auto fixture=[&]() {
    doc.clear();
    assert(!deserializeJson(doc,R"({"meta":{"err":null,"preBalances":[100,0],"postBalances":[90,10]},"transaction":{"message":{"accountKeys":[{"pubkey":"sender"},{"pubkey":"wallet"}],"instructions":[]}}})"));
  };
  uint64_t value=0;
  fixture(); assert(depositAmount(doc.as<JsonObject>(),"wallet",value) && value==10);
  fixture(); doc["meta"]["postBalances"][1]=uint64_t(1); assert(depositAmount(doc.as<JsonObject>(),"wallet",value) && value==1);
  fixture(); doc["meta"]["postBalances"][1]=uint64_t(0); assert(depositAmount(doc.as<JsonObject>(),"wallet",value) && value==0);
  fixture(); doc["meta"]["err"]="failed"; assert(depositAmount(doc.as<JsonObject>(),"wallet",value) && value==0);
  fixture(); doc["meta"].clear(); assert(!depositAmount(doc.as<JsonObject>(),"wallet",value));
  fixture(); assert(!depositAmount(doc.as<JsonObject>(),"absent",value));
  fixture(); doc["meta"]["postBalances"][1]="bad"; assert(!depositAmount(doc.as<JsonObject>(),"wallet",value));
  fixture();
  doc["meta"]["preBalances"][1]=uint64_t(5000000000ULL);
  doc["meta"]["postBalances"][1]=uint64_t(7000000000ULL);
  assert(depositAmount(doc.as<JsonObject>(),"wallet",value) && value==2000000000ULL);
  fixture(); doc["meta"]["postBalances"][1]=0;
  JsonObject ix=doc["transaction"]["message"]["instructions"].createNestedObject();
  ix["programId"]="11111111111111111111111111111111";
  ix["parsed"]["type"]="transfer";
  ix["parsed"]["info"]["source"]="sender";
  ix["parsed"]["info"]["destination"]="wallet";
  ix["parsed"]["info"]["lamports"]=uint64_t(7);
  assert(depositAmount(doc.as<JsonObject>(),"wallet",value) && value==7);
  ix["parsed"]["info"]["source"]="wallet";
  assert(depositAmount(doc.as<JsonObject>(),"wallet",value) && value==0);
  ix["parsed"]["info"]["source"]="sender";
  auto inner=doc["meta"].createNestedArray("innerInstructions").createNestedObject().createNestedArray("instructions");
  inner.add(ix);
  doc["transaction"]["message"]["instructions"].clear();
  assert(depositAmount(doc.as<JsonObject>(),"wallet",value) && value==7);
  std::cout << "PASS: native deposit parsing, failure, outgoing, self-transfer, inner transfer, 64-bit amounts\n";
}
