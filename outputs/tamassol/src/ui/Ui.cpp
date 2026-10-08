#include "Ui.h"
#include "OnlineConfig.h"

namespace tamassol {
namespace {
constexpr uint16_t kPanel = 0x0863;
constexpr uint16_t kSelected = 0x1146;
constexpr uint16_t kCyan = 0x07FF;
constexpr uint16_t kGold = 0xFDE0;
constexpr uint16_t kRed = 0xF986;
constexpr uint16_t kWhite = 0xF7BF;
constexpr uint16_t kGreen = 0x27E6;
void panel(TFT_eSPI& t, int16_t x, int16_t y, int16_t w, int16_t h,
           uint16_t fill, uint16_t edge) {
  t.fillRect(x+4,y,w-8,h,fill);
  t.fillRect(x,y+4,w,h-8,fill);
  t.fillTriangle(x,y+4,x+4,y,x+4,y+4,fill);
  t.fillTriangle(x+w-5,y,x+w-1,y+4,x+w-5,y+4,fill);
  t.fillTriangle(x,y+h-5,x+4,y+h-1,x+4,y+h-5,fill);
  t.fillTriangle(x+w-5,y+h-1,x+w-1,y+h-5,x+w-5,y+h-5,fill);
  t.drawFastHLine(x+4,y,w-8,edge);
  t.drawFastHLine(x+4,y+h-1,w-8,edge);
  t.drawFastVLine(x,y+4,h-8,edge);
  t.drawFastVLine(x+w-1,y+4,h-8,edge);
  t.drawLine(x,y+4,x+4,y,edge);
  t.drawLine(x+w-5,y,x+w-1,y+4,edge);
  t.drawLine(x,y+h-5,x+4,y+h-1,edge);
  t.drawLine(x+w-5,y+h-1,x+w-1,y+h-5,edge);
}
}

void Ui::begin() {
  auto& t = display_.canvas();
  display_.drawBackground(); // Exactly once; static landscape in flash.
  // Header is live text/shapes, independent of the background image.
  t.fillRect(0,0,320,28,kPanel);
  t.setTextDatum(TL_DATUM);
  t.setTextSize(2);
  t.setTextColor(kWhite,kPanel);
  t.drawString("TAMAS",9,6,1);
  t.setTextColor(kGold,kPanel);
  t.drawString("SOL",69,6,1);
  t.setTextSize(1);
  t.setTextColor(kWhite,kPanel);
  drawConnection(false,false,millis()); // No invented battery percentage.
  t.drawFastHLine(9,26,33,kGold);
  t.drawFastHLine(43,26,269,0x19ED);

  // Upper-left quote card, entirely outside the animation dirty rectangle.
  panel(t,7,37,85,120,kPanel,kCyan);
  t.fillCircle(21,49,8,kGold);
  t.drawCircle(21,49,6,0xFBC0);
  t.drawFastHLine(17,46,8,kWhite);
  t.drawFastHLine(17,49,8,kWhite);
  t.drawFastHLine(17,52,8,kWhite);
  t.setTextColor(kCyan,kPanel);
  t.drawString("SOL",35,43,1);
  t.setTextColor(kWhite,kPanel);
  t.drawString("$--.--",13,59,2); // No invented market quote before first successful HTTPS response.
  t.setTextColor(kCyan,kPanel);
  t.drawString("--.--% 24H",14,80,1);
  t.drawFastHLine(12,93,75,kCyan);
  drawAccount();

  t.setTextDatum(TC_DATUM);
  // Transparent text over static sky; never touched by animation updates.
  t.setTextColor(0x0822);
  t.drawString("SOLFLAME",175,37,2);
  t.setTextColor(kGold);
  t.drawString("SOLFLAME",174,36,2);
  t.setTextColor(kCyan);
  t.drawString("SEU COMPANHEIRO",174,56,1);
  drawWallet();
}

void Ui::drawWallet() {
  auto& t = display_.canvas();
  t.fillRect(0,200,320,40,kPanel); // Outside the unchanged mascot dirty rectangle.
  t.setTextSize(1);
  t.setTextDatum(TC_DATUM);
  if (receiving_) {
    t.setTextColor(kGold,kPanel);
    t.drawString("RECEBER - SOMENTE DEVNET",160,202,1);
    t.setTextColor(kWhite,kPanel);
    t.drawString(SOLANA_WALLET_ADDRESS,160,215,1);
    t.setTextColor(kCyan,kPanel);
    t.drawString("BOOT: VOLTAR",160,229,1);
    return;
  }
  panel(t,7,204,150,33,kPanel,0x2311);
  panel(t,163,204,150,33,kSelected,kCyan);
  // Small code-native icons, not a nonfunctional QR code.
  t.drawTriangle(19,219,34,211,28,230,0x7C30);
  t.drawLine(22,220,34,211,0x7C30);
  t.drawRect(174,213,14,15,kCyan);
  t.drawFastVLine(181,211,10,kCyan);
  t.drawLine(177,217,181,221,kCyan);
  t.drawLine(185,217,181,221,kCyan);
  t.setTextDatum(MC_DATUM);
  t.setTextColor(0x7C30,kPanel);
  t.drawString("ENVIAR (OFF)",96,221,1);
  t.setTextColor(kCyan,kSelected);
  t.drawString("RECEBER [BOOT]",248,221,1);
}
void Ui::drawAccount() {
  auto& t=display_.canvas();
  t.fillRect(12,98,76,54,kPanel);
  t.setTextSize(1);
  t.setTextDatum(TL_DATUM);
  t.setTextColor(kCyan,kPanel);
  t.drawString("SALDO DEVNET",13,99,1);
  char balance[40];
  if (balanceValid_) {
    if (balance_ && balance_<1000000ULL) snprintf(balance,sizeof(balance),"<0.001 SOL");
    else snprintf(balance,sizeof(balance),"%llu.%03llu SOL",balance_/1000000000ULL,(balance_%1000000000ULL)/1000000ULL);
  } else snprintf(balance,sizeof(balance),"-- SOL");
  // Solana mark: three alternating slanted bands, 12x13 native pixels.
  for (int row=0;row<3;++row) {
    t.drawFastHLine(15-row,111+row,10,kCyan);
    t.drawFastHLine(13+row,116+row,10,0x541F);
    t.drawFastHLine(15-row,121+row,10,0xA81F);
  }
  t.setTextColor(kWhite,kPanel);
  t.setViewport(28,109,60,19,false);
  const uint8_t font=t.textWidth(balance,2)<=60?2:1;
  t.drawString(balance,28,font==2?111:115,font);
  t.resetViewport();
  t.setTextColor(kCyan,kPanel);
  t.drawString("USD SIMULADO",13,131,1);
  if (balanceValid_ && price_>0) snprintf(balance,sizeof(balance),"~$%.2f",double(balance_)/1e9*price_);
  else snprintf(balance,sizeof(balance),"~$--.--");
  t.setViewport(12,141,76,10,false);
  t.drawString(balance,13,143,1);
  t.resetViewport();
}
void Ui::setBalance(uint64_t lamports, uint32_t receivedAt) {
  balanceAt_=receivedAt;
  if (balanceValid_ && balance_==lamports) return;
  balance_=lamports; balanceValid_=true;
  drawAccount();
}
void Ui::toggleReceive() { if (voice_!=VoiceUi::Idle) return; receiving_=!receiving_; drawWallet(); }
void Ui::drawVoice(VoiceUi state, uint32_t now) {
  const uint32_t frame=now/150U;
  if (state==voice_ && (state==VoiceUi::Idle || voiceFrame_==frame)) return;
  voice_=state; voiceFrame_=frame;
  if (state==VoiceUi::Idle) { drawWallet(); return; }
  auto& t=display_.canvas();
  // Only the footer changes; static landscape and mascot dirty rectangle stay untouched.
  panel(t,7,204,306,33,kPanel,kCyan);
  t.fillRoundRect(20,210,7,11,3,kCyan);
  t.drawLine(17,216,17,223,kCyan); t.drawLine(30,216,30,223,kCyan);
  t.drawFastHLine(18,224,12,kCyan); t.drawFastVLine(24,225,4,kCyan);
  t.drawFastHLine(20,229,9,kCyan);
  for (int i=0;i<3;++i) {
    const int h=state==VoiceUi::Listening?5+((frame+i)%4)*4:5;
    t.fillRect(40+i*6,228-h,3,h,kCyan);
  }
  t.setTextSize(1); t.setTextDatum(MC_DATUM); t.setTextColor(kCyan,kPanel);
  const char* label=state==VoiceUi::Listening?"ESTOU OUVINDO...":
                    state==VoiceUi::Request?"PREPARANDO VOZ...":
                    state==VoiceUi::PcOffline?"ABRA VOZ NO PC":
                    state==VoiceUi::Processing?"PROCESSANDO...":
                    state==VoiceUi::Confirm?"CONFIRME NO PC":
                    state==VoiceUi::Sending?"ENVIANDO - VEJA PC":
                    state==VoiceUi::Success?"ENVIO CONFIRMADO":
                    state==VoiceUi::Cancelled?"CANCELADO":
                    state==VoiceUi::Expired?"TEMPO ESGOTADO":
                    state==VoiceUi::Pending?"VERIFIQUE NO PC":
                    state==VoiceUi::Recognized?"FALA RECONHECIDA":"ERRO - VEJA O PC";
  t.setTextColor(state==VoiceUi::Success?kGreen:
                 (state==VoiceUi::Error || state==VoiceUi::Pending)?kGold:kCyan,kPanel);
  t.drawString(label,182,221,1);
}
void Ui::drawPrice(double usd,double change24h,uint32_t receivedAt) {
  priceAt_=receivedAt;
  price_=usd;
  auto& t=display_.canvas();
  char text[24];
  snprintf(text,sizeof(text),"$%.2f",usd);
  t.setTextSize(1);
  t.setTextDatum(TL_DATUM);
  t.setTextColor(kWhite,kPanel);
  t.fillRect(13,59,76,17,kPanel);
  t.setViewport(13,59,76,17,false);
  t.drawString(text,13,59,2);
  t.resetViewport();
  const uint16_t trend=change24h<0?kRed:(change24h>0?kGreen:kCyan);
  t.fillRect(12,78,76,12,kPanel);
  if (change24h<0) t.fillTriangle(14,80,18,86,22,80,trend);
  else if (change24h>0) t.fillTriangle(14,86,18,80,22,86,trend);
  else t.drawFastHLine(14,83,8,trend);
  snprintf(text,sizeof(text),"%+.1f%%",change24h);
  t.setTextColor(trend,kPanel);
  t.drawString(text,25,80,1);
  t.setTextColor(kCyan,kPanel);
  t.drawString("24H",68,80,1);
  drawAccount();
}
void Ui::drawConnection(bool connected,bool verified,uint32_t now) {
  const auto price=freshness(price_>0,connected,now,priceAt_,kPriceMaxAgeMs);
  const auto balance=freshness(balanceValid_,connected && verified,now,balanceAt_,kBalanceMaxAgeMs);
  const uint8_t code=uint8_t(price)+3*uint8_t(balance)+9*connected+18*verified;
  if (code==healthCode_) return;
  healthCode_=code;
  auto& t=display_.canvas();
  t.fillRect(236,2,80,22,kPanel);
  t.setTextSize(1); t.setTextDatum(TL_DATUM);
  t.setTextColor(!connected?kRed:verified?kGreen:kGold,kPanel);
  t.drawString(!connected?"WIFI OFF":verified?"WIFI / DEV":"REDE...",238,3,1);
  const auto label=[](Freshness s) { return s==Freshness::Missing?"--":s==Freshness::Fresh?"OK":"ANT"; };
  char line[16]; snprintf(line,sizeof(line),"P:%s S:%s",label(price),label(balance));
  t.setTextColor(price==Freshness::Fresh && balance==Freshness::Fresh?kCyan:kGold,kPanel);
  t.drawString(line,238,15,1);
  Serial.printf("HEALTH wifi=%s devnet=%s price=%s balance=%s\n",
                connected?"on":"off",verified?"verified":"waiting",label(price),label(balance));
}
void Ui::showSpark(uint64_t lamports) {
  auto& t=display_.canvas();
  clearSpark();
  t.setTextDatum(TC_DATUM);
  t.setTextSize(1);
  t.setTextColor(kGold,kPanel);
  t.drawString("+1 SPARK",172,3,1);
  char amount[40];
  snprintf(amount,sizeof(amount),"+%llu.%09llu SOL",lamports/1000000000ULL,lamports%1000000000ULL);
  t.setViewport(112,13,121,11,false);
  t.setTextColor(kCyan,kPanel);
  t.drawString(amount,172,14,1);
  t.resetViewport();
}
void Ui::clearSpark() { display_.canvas().fillRect(112,2,121,22,kPanel); }
void Ui::drawPairing(const PairingView& view, bool celebrating) {
  const bool footerChanged=view.pending!=link_.pending || strcmp(view.fingerprint,link_.fingerprint)!=0;
  auto& t=display_.canvas();
  if(celebrating) linkHeaderDirty_=true;
  else if(linkHeaderDirty_ || view.online!=link_.online || view.bound!=link_.bound || view.available!=link_.available) {
    t.fillRect(112,2,121,22,kPanel);
    t.setTextSize(1); t.setTextDatum(TC_DATUM);
    t.setTextColor(view.online?kGreen:kCyan,kPanel);
    t.drawString(!view.available?"VINCULO INDISP.":view.online?"USB AUTENTICADO":
                 view.bound?"VINCULO OFFLINE":"SEM VINCULO",172,9,1);
    linkHeaderDirty_=false;
  }
  if(footerChanged) {
    if(view.pending==PairingState::Pending::None) drawWallet();
    else {
      panel(t,7,204,306,33,kPanel,kCyan);
      t.setTextSize(1); t.setTextDatum(TC_DATUM); t.setTextColor(kGold,kPanel);
      t.drawString(view.pending==PairingState::Pending::Bind?"CONFIRA CODIGO NO PC":"REMOVER VINCULO?",160,208,1);
      char line[48]; snprintf(line,sizeof(line),"%s  BOOT: OK",view.fingerprint);
      t.setTextColor(kWhite,kPanel); t.drawString(line,160,222,1);
    }
  }
  link_=view;
}
} // namespace tamassol
