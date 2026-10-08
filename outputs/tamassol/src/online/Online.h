#pragma once
#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <atomic>
namespace tamassol {
struct OnlineEvent {
  enum Kind : uint8_t { Price, Deposit, Balance } kind;
  double price;
  double change24h;
  uint64_t lamports;
  uint32_t sparks;
  uint32_t receivedAt;
};
class Online {
 public:
  void begin();
  bool poll(OnlineEvent& event);
  bool connected() const;
  bool verified() const { return verified_.load(); }
 private:
  static void run(void* self);
  QueueHandle_t queue_ = nullptr;
  std::atomic<bool> verified_{false};
};
}
