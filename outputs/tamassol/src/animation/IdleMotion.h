#pragma once
#include <stdint.h>
#include "Celebration.h"
namespace tamassol {
struct IdlePose {
  int8_t breath=0, tail=0;
  int8_t lean=0, tilt=0, lift=0;
  bool blink=false;
  bool calmEyes=false;
};
inline IdlePose idlePose(uint32_t now, bool sleeping, bool blink) {
  const uint32_t phase=now%(sleeping?4000U:3200U);
  const uint32_t half=sleeping?2000U:1600U;
  IdlePose p;
  p.breath=int8_t((phase<half?phase:2*half-phase)*3/half);
  const uint32_t t=now%2800U;
  p.tail=t<700?0:t<1400?1:t<2100?0:-1;
  p.blink=blink&&!sleeping;
  return p;
}
// Inverse mapping avoids holes; paws stay anchored and only the tail tip sways.
// Original HAPPY art in every frame. Only tiny eye windows sample the open-eye
// reference; original closed eyes blink. Never sample its body or skin texture.
inline void composeIdle(uint16_t* out,const uint16_t* sprite,const uint8_t* mask,
                        const uint16_t* closedEyes,IdlePose pose) {
  for(int y=0;y<128;++y) for(int x=0;x<128;++x) {
    const int weight=y<124?124-y:0;
    const int sx=x-pose.lean*weight/124;
    int sy=y-(pose.breath*weight)/124+pose.lift*weight/124;
    sy-=pose.tilt*(x-64)*weight/(48*124);
    if(x>102 && y>48 && y<106) sy-=pose.tail*(x-102)/12;
    if(sy<0||sy>=128||sx<0||sx>=128) continue;
    const int i=sy*128+sx;
    if(!(mask[i>>3]&(1U<<(i&7)))) continue;
    const bool eye=pose.calmEyes?
      (((sx>=42&&sx<=61)||(sx>=73&&sx<=92)) && sy>=56&&sy<=68):
      (((sx>=41&&sx<=61)||(sx>=73&&sx<=93)) && sy>=54&&sy<=69);
    const bool replaceEyes=pose.calmEyes?!pose.blink:pose.blink;
    int eyeIndex=i;
    if(pose.calmEyes && eye) {
      const int sourceX=sx<=61?40+(sx-42)*18/19:75+(sx-73)*15/19;
      const int sourceY=58+(sy-56)*15/12;
      eyeIndex=sourceY*128+sourceX;
    }
    effectPixel(out,x,y+8,replaceEyes&&eye&&closedEyes?closedEyes[eyeIndex]:sprite[i]);
  }
}
}
