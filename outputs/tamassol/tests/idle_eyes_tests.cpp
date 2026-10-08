#include <cassert>
#include <fstream>
#include <vector>
#include <iostream>
#include "animation/IdleMotion.h"
#include "mascot/generated/IdleFrames.h"
#include "mascot/generated/SolflameFrames.h"
using namespace tamassol;
int main(int argc,char**argv) {
  std::vector<uint16_t> a(128*136+2,0x1234),b(a);
  for(int blink=0;blink<2;++blink) {
    auto &v=blink?b:a;
    for(int y=0;y<136;++y) for(int x=0;x<128;++x)
      v[1+y*128+x]=assets::kLandscape[(64+y)*320+96+x];
    IdlePose p; p.blink=blink; p.calmEyes=true;
    composeIdle(v.data()+1,assets::kHappy.frames[0],assets::kHappy.masks[0],assets::kIdleOpen,p);
    assert(v.front()==0x1234 && v.back()==0x1234);
  }
  unsigned diff=0;
  for(int y=0;y<136;++y) for(int x=0;x<128;++x) {
    if(a[1+y*128+x]!=b[1+y*128+x]) {
      ++diff; assert(y>=64 && y<=76 && ((x>=42&&x<=61)||(x>=73&&x<=92)));
    }
  }
  assert(diff>100);
  // Every original HAPPY body frame is retained, exactly, outside the eyes.
  for(unsigned frame=0;frame<assets::kHappy.count;++frame) {
    std::vector<uint16_t> original(128*136),opened(original),blinked(original);
    IdlePose p;
    composeIdle(original.data(),assets::kHappy.frames[frame],assets::kHappy.masks[frame],nullptr,p);
    p.calmEyes=true;
    composeIdle(opened.data(),assets::kHappy.frames[frame],assets::kHappy.masks[frame],assets::kIdleOpen,p);
    p.blink=true;
    composeIdle(blinked.data(),assets::kHappy.frames[frame],assets::kHappy.masks[frame],assets::kIdleOpen,p);
    assert(blinked==original);
    for(int y=0;y<136;++y) for(int x=0;x<128;++x) {
      bool eye=y>=64&&y<=76&&((x>=42&&x<=61)||(x>=73&&x<=92));
      if(!eye) assert(original[y*128+x]==opened[y*128+x]);
    }
  }
  if(argc>1) {
    std::ofstream f(argv[1],std::ios::binary);f<<"P6\n256 136\n255\n";
    for(int y=0;y<136;++y) for(int col=0;col<2;++col) for(int x=0;x<128;++x) {
      auto c=(col?b:a)[1+y*128+x];
      char rgb[]={char((c>>11)*255/31),char(((c>>5)&63)*255/63),char((c&31)*255/31)};
      f.write(rgb,3);
    }
  }
  std::cout<<"PASS: eyes change, body stable, buffer boundaries intact\n";
}
