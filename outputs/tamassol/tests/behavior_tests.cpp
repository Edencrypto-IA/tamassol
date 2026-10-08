#include <cassert>
#include <algorithm>
#include <fstream>
#include <iostream>
#include <vector>
#include "animation/BehaviorMotion.h"
#include "mascot/generated/SolflameFrames.h"
using namespace tamassol;
int main(int argc,char**argv) {
  std::vector<uint16_t> memory(128*136+2,0x1234);
  auto out=memory.data()+1;
  for(auto set:{&assets::kSleep,&assets::kHappy,&assets::kAngry})
    for(unsigned f=0;f<set->count;++f)
      for(uint32_t ms=0;ms<6500;ms+=50)
        for(int variant=0;variant<3;++variant) {
          auto p=curiousPose(idlePose(ms,false,false),ms%2800,variant);
          assert(p.lean>=-4&&p.lean<=4&&p.tilt>=-3&&p.tilt<=3&&p.lift<=3);
          composeIdle(out,set->frames[f],set->masks[f],assets::kSleep.frames[0],p);
          for(auto activity:{PetActivity::Listening,PetActivity::Thinking,PetActivity::Acknowledge}) {
            p=activityPose({},activity,ms);
            assert(p.lean>=-4&&p.lean<=4&&p.tilt>=-3&&p.tilt<=3&&p.lift<=3);
            composeIdle(out,set->frames[f],set->masks[f],nullptr,p);
          }
          composeMascot(out,set->frames[f],set->masks[f],ms,variant%2);
          assert(memory.front()==0x1234&&memory.back()==0x1234);
        }
  IdlePose current{},target{};target.lean=4;target.tilt=-3;target.lift=3;
  for(int i=0;i<4;++i) {
    const auto before=current;
    current=easePose(current,target);
    assert(current.lean-before.lean<=1);
  }
  assert(current.lean==4&&current.tilt==-3&&current.lift==3);
  std::vector<uint16_t> a(128*136),b(128*136);
  composeMascot(a.data(),assets::kHappy.frames[0],assets::kHappy.masks[0],250,0);
  composeMascot(b.data(),assets::kHappy.frames[0],assets::kHappy.masks[0],250,1);
  assert(a!=b);
  if(argc==2) {
    std::vector<uint16_t> sheet(768*272);
    for(int row=0;row<2;++row) for(int col=0;col<6;++col) {
      for(int y=0;y<136;++y) std::copy_n(assets::kLandscape+(64+y)*320+96,128,out+y*128);
      const uint32_t ms=row?2100:700;
      auto p=idlePose(ms,false,false);
      if(col==1) p=curiousPose(p,ms,0);
      if(col==2) p=activityPose(p,PetActivity::Listening,ms);
      if(col==3) p=activityPose(p,PetActivity::Thinking,ms);
      if(col<4) composeIdle(out,assets::kHappy.frames[0],assets::kHappy.masks[0],nullptr,p);
      else composeMascot(out,assets::kHappy.frames[0],assets::kHappy.masks[0],row?1500:250,col-4);
      for(int y=0;y<136;++y) std::copy_n(out+y*128,128,sheet.data()+(row*136+y)*768+col*128);
    }
    std::ofstream file(argv[1],std::ios::binary);assert(file);
    file<<"P6\n768 272\n255\n";
    for(auto p:sheet) { char rgb[]={char((p>>11)*255/31),char(((p>>5)&63)*255/63),char((p&31)*255/31)};file.write(rgb,3); }
  }
  std::cout<<"PASS behaviors: all sprites, bounds, easing, two celebrations\n";
}
