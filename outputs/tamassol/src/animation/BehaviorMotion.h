#pragma once
#include "IdleMotion.h"
namespace tamassol {
enum class PetActivity : uint8_t { Rest, Listening, Thinking, Acknowledge };
constexpr uint32_t kGestureDuration=2800;
inline int pulse(uint32_t phase,uint32_t duration,int height) {
  if(phase>=duration) return 0;
  const uint32_t half=duration/2;
  return int((phase<half?phase:duration-phase)*height/half);
}
inline IdlePose curiousPose(IdlePose p,uint32_t elapsed,uint8_t variant) {
  if(elapsed>=kGestureDuration) return p;
  const int left=pulse(elapsed,1400,4);
  const int right=elapsed>=1400?pulse(elapsed-1400,1400,4):0;
  if(variant%3==0) { p.lean=int8_t(right-left); p.tilt=p.lean/2; }
  else if(variant%3==1) {
    p.lift=int8_t(pulse(elapsed,2800,3));
    p.tilt=int8_t(pulse(elapsed,2800,3));
  } else {
    p.tail=int8_t((elapsed/350)%2?2:-2);
    p.lean=int8_t(pulse(elapsed,2800,3));
  }
  return p;
}
inline IdlePose activityPose(IdlePose p,PetActivity activity,uint32_t elapsed) {
  if(activity==PetActivity::Listening) {
    p.lean=int8_t(2+pulse(elapsed%2200,2200,2));
    p.tilt=2;
    p.lift=1;
    p.tail=int8_t((elapsed/500)%2);
  } else if(activity==PetActivity::Thinking) {
    const uint32_t phase=elapsed%3200;
    p.lean=int8_t(phase<1600?-pulse(phase,1600,3):pulse(phase-1600,1600,3));
    p.tilt=p.lean;
    p.lift=int8_t(pulse(phase%1600,1600,2));
  } else if(activity==PetActivity::Acknowledge && elapsed<1600) {
    p.lift=int8_t(pulse(elapsed%800,800,3));
    p.tail=int8_t((elapsed/200)%2?2:-2);
  }
  return p;
}
inline int8_t approach(int8_t current,int8_t target) {
  return current==target?current:int8_t(current+(current<target?1:-1));
}
inline IdlePose easePose(IdlePose current,IdlePose target) {
  current.breath=approach(current.breath,target.breath);
  current.tail=approach(current.tail,target.tail);
  current.lean=approach(current.lean,target.lean);
  current.tilt=approach(current.tilt,target.tilt);
  current.lift=approach(current.lift,target.lift);
  current.blink=target.blink;
  return current;
}
}
