#include <cassert>
#include <algorithm>
#include <fstream>
#include <iostream>
#include <vector>
#include "animation/IdleMotion.h"
#include "mascot/generated/SolflameFrames.h"
using namespace tamassol;
int main(int argc,char** argv) {
  std::vector<uint16_t> memory(128*136+2,0x1234);
  auto out=memory.data()+1;
  for(auto set:{&assets::kSleep,&assets::kHappy,&assets::kAngry})
    for(unsigned f=0;f<set->count;++f)
      for(unsigned ms=0;ms<10000;ms+=50) {
        std::fill(out,out+128*136,0);
        auto pose=idlePose(ms,set==&assets::kSleep,true);
        assert(pose.breath>=0&&pose.breath<=3&&pose.tail>=-1&&pose.tail<=1);
        if(set==&assets::kSleep) assert(!pose.blink);
        composeIdle(out,set->frames[f],set->masks[f],assets::kSleep.frames[0],pose);
        assert(memory.front()==0x1234&&memory.back()==0x1234);
      }
  std::vector<uint16_t> original(128*136,0);
  std::fill(out,out+128*136,0);
  composeMascot(original.data(),assets::kAngry.frames[0],assets::kAngry.masks[0],UINT32_MAX);
  composeIdle(out,assets::kAngry.frames[0],assets::kAngry.masks[0],nullptr,{});
  assert(std::equal(original.begin(),original.end(),out));
  if(argc==2) {
    std::ofstream file(argv[1],std::ios::binary);
    file<<"P6\n512 136\n255\n";
    std::vector<uint16_t> sheet(512*136);
    for(int n=0;n<4;++n) {
      for(int y=0;y<136;++y) std::copy_n(assets::kLandscape+(64+y)*320+96,128,out+y*128);
      IdlePose pose; pose.breath=n%2?3:0;pose.tail=n%2?1:-1;pose.blink=n>=2;
      composeIdle(out,assets::kAngry.frames[0],assets::kAngry.masks[0],assets::kSleep.frames[0],pose);
      for(int y=0;y<136;++y) std::copy_n(out+y*128,128,sheet.data()+y*512+n*128);
    }
    for(auto p:sheet) { char rgb[]={char((p>>11)*255/31),char(((p>>5)&63)*255/63),char((p&31)*255/31)};file.write(rgb,3); }
  }
  std::cout<<"PASS: idle bounds, sleep policy, neutral composition, all sprite frames\n";
}
