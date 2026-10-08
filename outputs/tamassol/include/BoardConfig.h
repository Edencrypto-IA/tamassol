#pragma once

// Official FNK0104A/B 2.8-inch profile. NOT a detection of the attached board.
// Source: Freenove/Freenove_ESP32_S3_Display, Libraries/FNK0104AB/
// TFT_eSPI_Setups_v1.3.zip : FNK0104AB_2.8_240x320_ILI9341.h
// Keep all LCD and physical-button assignments here; no guessed spare GPIOs.
#define USER_SETUP_LOADED
#define ILI9341_2_DRIVER
#define TFT_WIDTH 240
#define TFT_HEIGHT 320
#define TFT_MOSI 11
#define TFT_MISO 13
#define TFT_SCLK 12
#define TFT_CS 10
#define TFT_DC 46
#define TFT_RST -1
#define TFT_BL 45
#define TFT_BACKLIGHT_ON 1
#define TFT_RGB_ORDER TFT_BGR
#define TFT_INVERSION_ON
#define USE_HSPI_PORT
#define SPI_FREQUENCY 40000000
#define SPI_READ_FREQUENCY 10000000
#define LOAD_GLCD
#define LOAD_FONT2

#define TAMASSOL_BUTTON_NEXT 0
#define TAMASSOL_BUTTON_PREVIOUS -1
#define TAMASSOL_BUTTON_CONFIRM -1

#ifdef __cplusplus
#include <stdint.h>
namespace tamassol {
namespace board {
constexpr uint16_t kWidth = 320;
constexpr uint16_t kHeight = 240;
constexpr uint8_t kRotation = 1;
constexpr int8_t kNext = TAMASSOL_BUTTON_NEXT;
constexpr int8_t kPrevious = TAMASSOL_BUTTON_PREVIOUS;
constexpr int8_t kConfirm = TAMASSOL_BUTTON_CONFIRM;
constexpr uint16_t kDebounceMs = 30;
static_assert(kRotation == 1 || kRotation == 3, "Landscape is mandatory");
static_assert(kWidth == 320 && kHeight == 240, "TAMASSOL requires 320x240");
} // namespace board
} // namespace tamassol
#endif
