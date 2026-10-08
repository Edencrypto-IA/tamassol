#include <cassert>
#include <cstdint>
#include <iostream>
#include "animation/MoodSchedule.h"
using namespace tamassol;
int main() {
  MoodSchedule s;
  s.begin(0);
  assert(s.update(0,false)==AnimationId::Happy);
  s.setChange(2.5);
  assert(s.update(1,false)==AnimationId::Happy);
  s.setChange(-1);
  assert(s.update(90000,false)==AnimationId::Angry);
  assert(s.update(94001,false)==AnimationId::Happy);
  s.setChange(-3);
  assert(s.update(95000,false)==AnimationId::Happy); // cooldown
  assert(s.update(96000,true)==AnimationId::Happy);
  assert(s.update(96001,false)==AnimationId::Happy);
  uint32_t previous=0; bool varied=false;
  for(uint32_t seed=1;seed<20;++seed) {
    s.begin(0,seed); uint32_t nap=0;
    for(uint32_t t=0;t<=180000;t+=100)
      if(s.update(t,false)==AnimationId::Sleep) { nap=t; break; }
    assert(nap>=100000 && nap<=180000);
    if(previous && previous!=nap) varied=true;
    previous=nap;
    assert(s.update(nap+29999,false)==AnimationId::Sleep);
    assert(s.update(nap+30000,false)==AnimationId::Happy);
  }
  assert(varied);
  // Same schedule around unsigned millis rollover.
  s.begin(UINT32_MAX-1000U);
  s.setChange(1);s.setChange(-1);
  assert(s.update(static_cast<uint32_t>(UINT32_MAX-1000U+90000U),false)==AnimationId::Angry);
  assert(s.update(static_cast<uint32_t>(UINT32_MAX-1000U+94001U),false)==AnimationId::Happy);
  s.begin(0);
  s.setChange(-2);s.setChange(-2.1);
  MoodSchedule reference; reference.begin(0);
  assert(s.update(90000,false)==reference.update(90000,false)); // no market reaction
  assert(s.update(180000,false)==AnimationId::Sleep);
  assert(s.update(180001,true)==AnimationId::Happy);
  assert(s.update(180002,false)==AnimationId::Happy);
  // No network is required for visible expression changes; never get stuck smiling.
  for(uint32_t seed=1;seed<=40;++seed) {
    s.begin(0,seed);
    auto last=s.update(0,false); uint32_t since=0; unsigned changes=0;
    for(uint32_t t=100;t<95000;t+=100) {
      auto current=s.update(t,false);
      if(current!=last) {
        const uint32_t duration=t-since;
        assert(last==AnimationId::Happy?duration>=8000 && duration<=16100:
               duration>=3000 && duration<=6100);
        last=current; since=t; ++changes;
      }
    }
    assert(changes>=6);
    assert(s.update(95000,true)==AnimationId::Happy);
    assert(s.update(96000,true)==AnimationId::Happy);
    assert(s.update(96001,false)==AnimationId::Happy);
  }
  std::cout << "PASS: brief moods, cooldown, threshold, varied naps, interaction, rollover\n";
}
