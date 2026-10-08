#include "Mascot.h"
#include <Arduino.h>

namespace tamassol {
uint16_t Mascot::frameDurationMs(AnimationId id) {
  return id == AnimationId::Sleep ? 250 : 125; // 4 / 8 / 8 sprite FPS.
}
void Mascot::setAnimation(AnimationId id) {
  switch (id) {
    case AnimationId::Happy: frames_ = &assets::kHappy; break;
    case AnimationId::Angry: frames_ = &assets::kAngry; break;
    default: id = AnimationId::Sleep; frames_ = &assets::kSleep; break;
  }
  player_.start(id, frames_->count, frameDurationMs(id), millis());
  blinkClock_=millis(); blinkInterval_=uint32_t(random(3200,7200)); blink_=false;
  dirty_ = true;
}
void Mascot::startCelebration(uint32_t now) {
  celebrating_=true; celebrationStart_=now; effectFrame_=UINT32_MAX; dirty_=true;
  celebrationVariant_=(celebrationVariant_+1)%2;
}
void Mascot::stopCelebration() { celebrating_=false; dirty_=true; }
void Mascot::setActivity(PetActivity activity,uint32_t now) {
  if(activity==activity_) return;
  activity_=activity; activityAt_=now; dirty_=true;
  gestureActive_=false; gestureAt_=now;
}
float Mascot::targetFps() const {
  return celebrating_ || activity_!=PetActivity::Rest?20.0f:
         player_.animation()==AnimationId::Sleep?8.0f:16.0f;
}
void Mascot::update() {
  const uint32_t now=millis();
  const bool changed=player_.update(now);
  const bool canBlink=player_.animation()==AnimationId::Angry && !celebrating_;
  if(now-blinkClock_>=blinkInterval_+200U) {
    blinkClock_=now; blinkInterval_=uint32_t(random(3200,7200));
  }
  const bool blinking=canBlink && now-blinkClock_>=blinkInterval_;
  if(blinking!=blink_) { blink_=blinking; dirty_=true; }
  (void)changed; // Sprite frame advances independently from the smoother pose renderer.
  const bool resting=activity_==PetActivity::Rest && !celebrating_;
  const bool sleeping=player_.animation()==AnimationId::Sleep;
  if(!resting || sleeping) { gestureActive_=false; gestureAt_=now; }
  else if(!gestureActive_ && now-gestureAt_>=gestureWait_) {
    gestureActive_=true; gestureAt_=now;
    gestureVariant_=(gestureVariant_+uint8_t(random(1,3)))%3;
  } else if(gestureActive_ && now-gestureAt_>=kGestureDuration) {
    gestureActive_=false; gestureAt_=now; gestureWait_=uint32_t(random(5000,11000));
  }
  const uint32_t interval=uint32_t(1000.0f/targetFps());
  if(now-renderAt_>=interval) {
    renderAt_=now;
    auto target=idlePose(now,sleeping,blink_);
    if(gestureActive_) target=curiousPose(target,now-gestureAt_,gestureVariant_);
    target=activityPose(target,activity_,now-activityAt_);
    pose_=easePose(pose_,target);
    dirty_=true;
  }
}
bool Mascot::draw() {
  if (!dirty_ || !frames_ || !frames_->count) return false;
  auto pose=pose_; pose.calmEyes=false;
  if(player_.animation()==AnimationId::Happy) pose.blink=false;
  display_.drawFrame(frames_->frames[player_.frame()], frames_->masks[player_.frame()], 96, 72,
                     celebrating_?millis()-celebrationStart_:UINT32_MAX,
                     pose,celebrationVariant_);
  dirty_ = false;
  return true;
}
} // namespace tamassol
