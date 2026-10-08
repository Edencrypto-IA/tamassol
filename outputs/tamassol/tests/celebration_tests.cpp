#include <cassert>
#include <algorithm>
#include <iostream>
#include <fstream>
#include <string>
#include <vector>
#include "animation/Celebration.h"
#include "mascot/generated/SolflameFrames.h"
using namespace tamassol;
int main(int argc,char** argv) {
  constexpr size_t count=kEffectWidth*kEffectHeight;
  std::vector<uint16_t> guarded(count+2,0x1234);
  uint16_t* out=guarded.data()+1;
  for (unsigned frame=0;frame<assets::kHappy.count;++frame) {
    auto pixels=assets::kHappy.frames[frame];
    auto mask=assets::kHappy.masks[frame];
    std::fill(out,out+count,0x0001);
    composeMascot(out,pixels,mask,UINT32_MAX);
    for(int y=0;y<136;++y) for(int x=0;x<128;++x) {
      int i=(y-8)*128+x;
      const bool opaque=y>=8 && (mask[i>>3]&(1U<<(i&7)));
      assert(out[y*128+x]==(opaque?pixels[i]:0x0001));
    }
    for(uint32_t ms=0;ms<=6100;ms+=25) {
      std::fill(out,out+count,0x0001);
      composeMascot(out,pixels,mask,ms);
      assert(guarded.front()==0x1234 && guarded.back()==0x1234);
    }
  }
  // Optional offline frames rendered by the exact production compositor.
  if (argc==2) for(int frame=0;frame<60;++frame) {
    uint32_t ms=frame*100;
    for(int y=0;y<136;++y)
      std::copy_n(assets::kLandscape+(64+y)*320+96,128,out+y*128);
    unsigned n=(ms/125)%assets::kHappy.count;
    composeMascot(out,assets::kHappy.frames[n],assets::kHappy.masks[n],ms);
    std::ofstream file(std::string(argv[1])+"/celebration_"+std::to_string(frame)+".ppm",std::ios::binary);
    assert(file);
    file << "P6\n128 136\n255\n";
    for(size_t i=0;i<count;++i) {
      unsigned p=out[i];
      char rgb[3]={char(((p>>11)&31)*255/31),char(((p>>5)&63)*255/63),char((p&31)*255/31)};
      file.write(rgb,3);
    }
  }
  std::cout << "PASS: normal composition identical, all frames/effect times within bounds\n";
}
