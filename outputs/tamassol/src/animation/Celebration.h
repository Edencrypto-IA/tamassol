#pragma once
#include <stdint.h>
namespace tamassol {
constexpr int kEffectWidth=128;
constexpr int kEffectHeight=136;
constexpr uint32_t kCelebrationDuration=6000;
inline void effectPixel(uint16_t* out,int x,int y,uint16_t color) {
  if (x>=0 && x<kEffectWidth && y>=0 && y<kEffectHeight) out[y*kEffectWidth+x]=color;
}
// Code-native effects around the unchanged original sprite; no allocations or decoding.
inline void composeMascot(uint16_t* out,const uint16_t* sprite,const uint8_t* mask,uint32_t elapsed,uint8_t variant=0) {
  const bool active=elapsed<kCelebrationDuration;
  int jump=0;
  if (active && elapsed<3600) {
    const int period=variant%2?1200:900;
    const int flight=variant%2?900:600;
    const int phase=elapsed%period;
    if (phase<flight) jump=phase<flight/2?phase*8/(flight/2):(flight-phase)*8/(flight/2);
  }
  const int offset=8-jump;
  if (active) {
    const uint16_t glow=(elapsed/180)%2?0xFFE0:(variant%2?0x07FF:0xFC40);
    // Pulsing silhouette, painted first so no original sprite detail is replaced.
    for (int i=0;i<128*128;++i) if (mask[i>>3] & (1U<<(i&7))) {
      int x=i%128,y=i/128+offset;
      effectPixel(out,x-1,y,glow); effectPixel(out,x+1,y,glow);
      effectPixel(out,x,y-1,glow); effectPixel(out,x,y+1,glow);
    }
    // Small landing ring beneath the paws.
    int spread=12+int((elapsed%900)*20/900);
    for(int dx=-spread;dx<=spread;++dx) {
      effectPixel(out,66+dx,133,0xFDE0);
      if (dx%3==0) effectPixel(out,66+dx,132,0xFC40);
    }
  }
  for (int i=0;i<128*128;++i)
    if (mask[i>>3] & (1U<<(i&7))) effectPixel(out,i%128,i/128+offset,sprite[i]);
  if (active) {
    for (int n=0;n<14;++n) {
      const uint32_t age=(elapsed+uint32_t(n)*137U)%1500U;
      int x=(n%2)?112+((n*7)%14):3+((n*5)%12);
      if(variant%2) x+=(n%2?-1:1)*int(age%600/200);
      int y=128-int(age*118U/1500U);
      const uint16_t c=n%3==0?0x07FF:(n%3==1?0xFFE0:0xFFFF);
      effectPixel(out,x,y,c);
      if (age<1150) {
        effectPixel(out,x-1,y,c); effectPixel(out,x+1,y,c);
        effectPixel(out,x,y-1,c); effectPixel(out,x,y+1,c);
      }
    }
  }
}
}
