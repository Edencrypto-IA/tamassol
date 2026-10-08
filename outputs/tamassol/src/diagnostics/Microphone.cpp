// ES8311 register sequence adapted from Freenove Sketch_07.2_Echo/es8311.cpp.
// SPDX-FileCopyrightText: 2015-2022 Espressif Systems (Shanghai) CO LTD
// SPDX-License-Identifier: Apache-2.0
#include "Microphone.h"
#include "pairing/Pairing.h"
#include "veil/VeilApproval.h"
#include "ReplyAudio.h"
#include <Arduino.h>
#include <Wire.h>
#include <driver/i2s.h>
#include <atomic>
#include <cmath>
#include <cstring>

namespace tamassol {
namespace {
// Official FNK0104AB Echo example; no LCD assignments changed.
constexpr int kMclk=4, kBclk=5, kInput=6, kOutput=8, kWs=7;
constexpr int kAmp=1, kSda=16, kScl=15;
constexpr uint8_t kCodec=0x18;
std::atomic<bool> running{false};
std::atomic<VoiceUi> voiceUi{VoiceUi::Idle};
std::atomic<uint32_t> voiceUiAt{0};
bool voiceHostReady=false;
uint32_t voiceHostAt=0;
void setVoiceUi(VoiceUi state) {
  voiceUiAt.store(millis());
  voiceUi.store(state);
}
std::atomic<bool> stopRequested{false};
std::atomic<uint32_t> usbAck{UINT32_MAX};
bool reg(uint8_t address, uint8_t value);

// Bounded USB-only transfer. Raw voice is never passed to Online or NVS.
bool captureUsb(bool longCapture) {
  const uint32_t duration=longCapture?7000U:4000U;
  const size_t count=duration*16U; // 16 kHz mono PCM; legacy four-second mode preserved.
  auto* audio=static_cast<int16_t*>(ps_malloc(count*sizeof(int16_t)));
  if (!audio) { Serial.printf("\n@VOICE ERROR memory\n"); return false; }
  size_t total=0;
  bool ok=true;
  i2s_zero_dma_buffer(I2S_NUM_0);
  setVoiceUi(VoiceUi::Listening);
  Serial.printf("\n@VOICE LISTEN %u\n",unsigned(duration));
  const uint32_t started=millis();
  while (total<count && !stopRequested.load() && millis()-started<duration+1500U) {
    size_t bytes=0;
    const size_t wanted=min(static_cast<size_t>(512),(count-total)*sizeof(int16_t));
    if (i2s_read(I2S_NUM_0,audio+total,wanted,&bytes,pdMS_TO_TICKS(100))!=ESP_OK) { ok=false; break; }
    total+=bytes/sizeof(int16_t);
  }
  ok=ok && total==count && !stopRequested.load();
  i2s_stop(I2S_NUM_0); // Microphone clock stops before USB transfer.
  setVoiceUi(VoiceUi::Processing);
  reg(0x00,0x1f);
  if (ok) {
    usbAck.store(UINT32_MAX);
    for(int retry=0;retry<20 && usbAck.load()!=0 && !stopRequested.load();++retry) {
      Serial.printf("\n@VOICE BEGIN %u\n",unsigned(count*2));
      vTaskDelay(pdMS_TO_TICKS(50));
    }
    ok=usbAck.load()==0;
    const auto* data=reinterpret_cast<const uint8_t*>(audio);
    uint32_t hash=2166136261U;
    const uint32_t transferStarted=millis();
    for (size_t offset=0;ok && offset<count*2;offset+=128) {
      if (!Serial || stopRequested.load() || millis()-transferStarted>45000U) { ok=false; break; }
      char hex[257];
      constexpr char digits[]="0123456789abcdef";
      for (size_t j=0;j<128;++j) {
        const uint8_t b=data[offset+j]; hash=(hash^b)*16777619U;
        hex[2*j]=digits[b>>4]; hex[2*j+1]=digits[b&15];
      }
      hex[256]='\0';
      for(int retry=0;retry<20 && usbAck.load()!=offset+128 && !stopRequested.load();++retry) {
        Serial.printf("\n@VOICE DATA %u %s\n",unsigned(offset),hex);
        const uint32_t sent=millis();
        while(usbAck.load()!=offset+128 && millis()-sent<50 && !stopRequested.load()) vTaskDelay(1);
      }
      ok=usbAck.load()==offset+128;
    }
    if(ok) Serial.printf("\n@VOICE END %08lx\n",static_cast<unsigned long>(hash));
  }
  memset(audio,0,count*sizeof(int16_t)); free(audio);
  if (!ok) { setVoiceUi(VoiceUi::Idle); Serial.printf("\n@VOICE ERROR capture_or_transfer\n"); }
  return ok;
}

bool reg(uint8_t address, uint8_t value) {
  Wire.beginTransmission(kCodec);
  Wire.write(address); Wire.write(value);
  const auto error=Wire.endTransmission();
  if (error) Serial.printf("MIC I2C error=%u register=0x%02x\n", error,address);
  return error==0;
}

bool codecBegin() {
  if (!reg(0x00,0x1f)) return false;
  vTaskDelay(pdMS_TO_TICKS(20)); // Worker only, never the animation task.
  // Slave I2S, 16-bit, MCLK=4096000 Hz, Fs=16000 Hz; official divider table.
  const uint8_t sequence[][2]={
    {0x00,0x00},{0x00,0x80},{0x01,0x3f},{0x06,0x00},
    {0x02,0x00},{0x03,0x10},{0x04,0x10},{0x05,0x00},
    {0x06,0x03},{0x07,0x00},{0x08,0xff},{0x00,0x80},
    {0x09,0x0c},{0x0a,0x0c},{0x0d,0x01},{0x0e,0x02},
    {0x12,0x00},{0x13,0x10},{0x1c,0x6a},{0x37,0x08},
    {0x32,0x00},{0x17,0xc8},{0x14,0x1a}
  };
  for (const auto& entry:sequence) if (!reg(entry[0],entry[1])) return false;
  return true;
}

void measure(void* argument) {
  const bool usb=argument!=nullptr;
  bool installed=false, wire=false;
  pinMode(kAmp,OUTPUT); digitalWrite(kAmp,HIGH); // SC8002B shutdown is HIGH.
  do {
    wire=Wire.begin(kSda,kScl,400000);
    if (!wire) { Serial.println("MIC FAIL I2C init"); break; }
    Wire.setTimeOut(50);
    Wire.beginTransmission(kCodec);
    if (Wire.endTransmission()!=0) { Serial.println("MIC FAIL codec 0x18 not responding"); break; }
    Serial.println("MIC codec 0x18 ACK; starting level-only test, 60 seconds");
    i2s_config_t config{};
    config.mode=static_cast<i2s_mode_t>(I2S_MODE_MASTER|I2S_MODE_RX);
    config.sample_rate=16000;
    config.bits_per_sample=I2S_BITS_PER_SAMPLE_16BIT;
    config.channel_format=I2S_CHANNEL_FMT_ONLY_LEFT;
    config.communication_format=I2S_COMM_FORMAT_STAND_I2S;
    config.intr_alloc_flags=ESP_INTR_FLAG_LEVEL1;
    config.dma_buf_count=4; config.dma_buf_len=256;
    config.use_apll=false;
    config.fixed_mclk=4096000;
    config.mclk_multiple=I2S_MCLK_MULTIPLE_256;
    auto error=i2s_driver_install(I2S_NUM_0,&config,0,nullptr);
    if (error!=ESP_OK) { Serial.printf("MIC FAIL install %s\n",esp_err_to_name(error)); break; }
    installed=true;
    i2s_pin_config_t pins{};
    pins.mck_io_num=kMclk; pins.bck_io_num=kBclk; pins.ws_io_num=kWs;
    pins.data_out_num=I2S_PIN_NO_CHANGE; pins.data_in_num=kInput;
    error=i2s_set_pin(I2S_NUM_0,&pins);
    if (error!=ESP_OK) { Serial.printf("MIC FAIL pins %s\n",esp_err_to_name(error)); break; }
    if (!codecBegin()) break;
    vTaskDelay(pdMS_TO_TICKS(300));
    if (usb) { captureUsb(argument==reinterpret_cast<void*>(2)); break; }
    const uint32_t start=millis();
    uint32_t window=start, count=0, clipped=0;
    int64_t sum=0; uint64_t squares=0;
    int minimum=32767,maximum=-32768;
    int16_t samples[256]{};
    while (millis()-start<60000U && !stopRequested.load()) {
      size_t bytes=0;
      error=i2s_read(I2S_NUM_0,samples,sizeof(samples),&bytes,pdMS_TO_TICKS(100));
      if (error!=ESP_OK) { Serial.printf("MIC FAIL read %s\n",esp_err_to_name(error)); break; }
      for (size_t i=0;i<bytes/sizeof(samples[0]);++i) {
        const int value=samples[i];
        sum+=value; squares+=static_cast<int64_t>(value)*value; ++count;
        if(value<minimum) minimum=value;
        if(value>maximum) maximum=value;
        if(value>=32760 || value<=-32760) ++clipped;
      }
      if (millis()-window>=500U) {
        const double mean=count?static_cast<double>(sum)/count:0;
        const double variance=count?static_cast<double>(squares)/count-mean*mean:0;
        const double rms=sqrt(variance>0?variance:0);
        Serial.printf("MIC t=%lus samples=%lu rms=%.1f dBFS=%.1f span=%d clipped=%lu\n",
          static_cast<unsigned long>((millis()-start)/1000),static_cast<unsigned long>(count),
          rms,rms>0?20*log10(rms/32768.0):-120.0,count?maximum-minimum:0,
          static_cast<unsigned long>(clipped));
        window=millis(); count=clipped=0; sum=0; squares=0; minimum=32767; maximum=-32768;
      }
    }
    memset(samples,0,sizeof(samples)); // No audio file, network or PCM serial output.
  } while(false);
  if (wire) { reg(0x00,0x1f); Wire.end(); }
  if (installed) i2s_driver_uninstall(I2S_NUM_0);
  Serial.printf("\n%s\n",usb?"@VOICE IDLE":"MIC STOP: capture disabled; MIC TEST to repeat");
  running.store(false);
  vTaskDelete(nullptr);
}

void speakerTest(void* argument) {
  const bool reply=argument!=nullptr;
  bool installed=false, wire=false, success=false;
  pinMode(kAmp,OUTPUT); digitalWrite(kAmp,HIGH);
  do {
    wire=Wire.begin(kSda,kScl,400000);
    if (!wire) { Serial.println("SPEAKER FAIL I2C init"); break; }
    Wire.setTimeOut(50);
    i2s_config_t config{};
    config.mode=static_cast<i2s_mode_t>(I2S_MODE_MASTER|I2S_MODE_TX);
    config.sample_rate=16000; config.bits_per_sample=I2S_BITS_PER_SAMPLE_16BIT;
    config.channel_format=I2S_CHANNEL_FMT_RIGHT_LEFT;
    config.communication_format=I2S_COMM_FORMAT_STAND_I2S;
    config.intr_alloc_flags=ESP_INTR_FLAG_LEVEL1;
    config.dma_buf_count=4; config.dma_buf_len=256;
    config.tx_desc_auto_clear=true;
    config.fixed_mclk=4096000; config.mclk_multiple=I2S_MCLK_MULTIPLE_256;
    auto error=i2s_driver_install(I2S_NUM_0,&config,0,nullptr);
    if (error!=ESP_OK) { Serial.printf("SPEAKER FAIL install %s\n",esp_err_to_name(error)); break; }
    installed=true;
    i2s_pin_config_t pins{};
    pins.mck_io_num=kMclk; pins.bck_io_num=kBclk; pins.ws_io_num=kWs;
    pins.data_out_num=kOutput; pins.data_in_num=I2S_PIN_NO_CHANGE;
    error=i2s_set_pin(I2S_NUM_0,&pins);
    if (error!=ESP_OK) { Serial.printf("SPEAKER FAIL pins %s\n",esp_err_to_name(error)); break; }
    if (!codecBegin() || !reg(0x31,0x00) || !reg(0x32,0xbf)) break; // DAC -32dB.
    i2s_zero_dma_buffer(I2S_NUM_0);
    vTaskDelay(pdMS_TO_TICKS(100));
    digitalWrite(kAmp,LOW); // Official Freenove playback enable level.
    Serial.printf("SPEAKER START: %s; no microphone capture\n",reply?"Estou aqui":"three soft tones");
    bool ok=true;
    int16_t pcm[256]; // 128 stereo frames, generated locally, bounded stack usage.
    if (reply) {
      Serial.printf("\n@VOICE REPLY\n");
      for(size_t offset=0;offset<kReplySamples && ok && !stopRequested.load();offset+=128) {
        const size_t frames=min(static_cast<size_t>(128),kReplySamples-offset);
        for(size_t i=0;i<frames;++i) pcm[2*i]=pcm[2*i+1]=kReplyAudio[offset+i];
        size_t written=0;
        const size_t bytes=frames*2*sizeof(int16_t);
        error=i2s_write(I2S_NUM_0,pcm,bytes,&written,pdMS_TO_TICKS(200));
        ok=error==ESP_OK && written==bytes;
      }
      // Drain the small DMA queue with silence before disabling the amplifier.
      memset(pcm,0,sizeof(pcm));
      for(int i=0;i<10 && ok;++i) {
        size_t written=0;
        error=i2s_write(I2S_NUM_0,pcm,sizeof(pcm),&written,pdMS_TO_TICKS(200));
        ok=error==ESP_OK && written==sizeof(pcm);
      }
    }
    for (int tone=0;!reply && tone<3 && ok && !stopRequested.load();++tone) {
      const double hz=440.0+220.0*tone;
      for (int offset=0;offset<8000 && ok;offset+=128) {
        const int frames=(8000-offset<128)?8000-offset:128;
        for (int i=0;i<frames;++i) {
          const int t=offset+i;
          double envelope=0;
          if (t<4800) envelope=fmin(1.0,fmin(t/160.0,(4799-t)/160.0));
          const int16_t sample=static_cast<int16_t>(12000*envelope*sin(6.283185307179586*hz*t/16000));
          pcm[2*i]=pcm[2*i+1]=sample;
        }
        size_t written=0;
        const size_t bytes=frames*2*sizeof(int16_t);
        error=i2s_write(I2S_NUM_0,pcm,bytes,&written,pdMS_TO_TICKS(200));
        if (error!=ESP_OK || written!=bytes) {
          Serial.printf("SPEAKER FAIL write %s bytes=%u/%u\n",esp_err_to_name(error),unsigned(written),unsigned(bytes));
          ok=false;
        }
      }
    }
    vTaskDelay(pdMS_TO_TICKS(100)); // Drain final silence, worker only.
    success=ok && !stopRequested.load();
  } while(false);
  digitalWrite(kAmp,HIGH);
  if (wire) { reg(0x32,0x00); reg(0x00,0x1f); Wire.end(); }
  if (installed) i2s_driver_uninstall(I2S_NUM_0);
  Serial.printf("SPEAKER STOP: %s; amplifier disabled\n",success?"PCM sent successfully":"FAILED");
  if (reply) Serial.printf("\n@VOICE %s\n",success?"REPLIED":"ERROR playback");
  running.store(false);
  vTaskDelete(nullptr);
}
}

bool microphoneBusy() { return running.load(); }
void requestVoiceCapture() {
  const auto state=voiceUiState();
  if (running.load() || pairingPending() || state==VoiceUi::Listening ||
      state==VoiceUi::Processing || state==VoiceUi::Confirm ||
      state==VoiceUi::Sending || state==VoiceUi::Request) return;
  if (!voiceHostReady || uint32_t(millis()-voiceHostAt)>=12000U) {
    setVoiceUi(VoiceUi::PcOffline);
    return;
  }
  setVoiceUi(VoiceUi::Request);
  Serial.println("@VOICE REQUEST");
}
VoiceUi voiceUiState() {
  const auto state=voiceUi.load();
  // A disconnected PC must never leave a permanent listening/confirmation badge.
  return visibleVoiceState(state,millis()-voiceUiAt.load());
}
void pollMicrophoneDiagnostic() {
  static char command[3072]{};
  static size_t length=0;
  static bool overflow=false;
  for (int budget=0;budget<16 && Serial.available();++budget) {
    const char c=static_cast<char>(Serial.read());
    if (c=='\r') continue;
    if (c=='\n') {
      command[length]='\0';
      if (!overflow && strncmp(command,"VEIL ",5)==0) {
        if (running.load() || pairingPending() || voiceUiState()!=VoiceUi::Idle) Serial.println("@VEIL ERROR busy");
        else veilCommand(command);
        length=0; overflow=false; continue;
      }
      if (veilActive()) { Serial.println("@COMMAND ERROR veil_pending"); length=0; overflow=false; continue; }
      if (!overflow && strncmp(command,"PAIR ",5)==0) {
        if (running.load() || voiceUiState()!=VoiceUi::Idle) Serial.println("@PAIR ERROR audio_busy");
        else pairingCommand(command);
        length=0; overflow=false; continue;
      }
      if (overflow) Serial.println("@COMMAND ERROR too_long");
      if (!overflow && strcmp(command,"VOICE HOST READY")==0) {
        voiceHostReady=true; voiceHostAt=millis();
      }
      if (!overflow && strcmp(command,"VOICE HOST OFF")==0) voiceHostReady=false;
      if (!overflow && strncmp(command,"VOICE ACK ",10)==0) {
        char* end=nullptr;
        const unsigned long value=strtoul(command+10,&end,10);
        if(end!=command+10 && *end=='\0' && value<=224000) usbAck.store(value);
      }
      const bool mic=strcmp(command,"MIC TEST")==0;
      const bool speaker=strcmp(command,"SPEAKER TEST")==0;
      const bool longCapture=strcmp(command,"VOICE CAPTURE7")==0;
      const bool capture=strcmp(command,"VOICE CAPTURE")==0 || longCapture;
      const bool reply=strcmp(command,"VOICE REPLY")==0;
      if (!overflow && strcmp(command,"VOICE STOP")==0) { stopRequested.store(true); setVoiceUi(VoiceUi::Idle); }
      if (!overflow && !running.load() && !pairingPending()) {
        if (strcmp(command,"UI VOICE PROCESS")==0) setVoiceUi(VoiceUi::Processing);
        if (strcmp(command,"UI VOICE CONFIRM")==0) setVoiceUi(VoiceUi::Confirm);
        if (strcmp(command,"UI VOICE IDLE")==0) setVoiceUi(VoiceUi::Idle);
        if (strcmp(command,"UI VOICE SUCCESS")==0) setVoiceUi(VoiceUi::Success);
        if (strcmp(command,"UI VOICE CANCELLED")==0) setVoiceUi(VoiceUi::Cancelled);
        if (strcmp(command,"UI VOICE EXPIRED")==0) setVoiceUi(VoiceUi::Expired);
        if (strcmp(command,"UI VOICE ERROR")==0) setVoiceUi(VoiceUi::Error);
        if (strcmp(command,"UI VOICE PENDING")==0) setVoiceUi(VoiceUi::Pending);
        if (strcmp(command,"UI VOICE RECOGNIZED")==0) setVoiceUi(VoiceUi::Recognized);
        if (strcmp(command,"UI VOICE SENDING")==0) setVoiceUi(VoiceUi::Sending);
      }
      if (!overflow && (mic || speaker || capture || reply) && pairingPending())
        Serial.println("@VOICE ERROR pairing_pending");
      if (!overflow && (mic || speaker || capture || reply) && !pairingPending() && !running.exchange(true)) {
        stopRequested.store(false);
        if (xTaskCreatePinnedToCore((mic||capture)?measure:speakerTest,"audio-test",4096,
              longCapture?reinterpret_cast<void*>(2):(capture||reply)?reinterpret_cast<void*>(1):nullptr,1,nullptr,0)!=pdPASS) {
          running.store(false); Serial.println("AUDIO FAIL task allocation");
        }
      }
      length=0; overflow=false;
    } else if (length<sizeof(command)-1) command[length++]=c;
    else overflow=true;
  }
}
}
