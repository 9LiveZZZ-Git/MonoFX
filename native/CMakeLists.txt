cmake_minimum_required(VERSION 3.16)
project(monofx_native LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

# The DSP library. Deliberately free of any plugin-framework header so it can be
# unit-tested without a host and re-shelled for VST3 / AU / CLAP / AAX later.
add_library(monofx_core INTERFACE)
target_include_directories(monofx_core INTERFACE ${CMAKE_CURRENT_SOURCE_DIR}/monofx_core)

# ---------------------------------------------------------------------------
# Floating-point flags. These are not tuning knobs — they decide whether two
# builds of identical source produce identical audio.
#
#   -ffp-contract=off  GCC defaults to `fast` on x86-64, which fuses a*b+c into
#                      an FMA ACROSS STATEMENTS and skips the intermediate
#                      rounding. Contraction opportunities change with inlining
#                      and optimisation level, so with the default the same
#                      source gives different output at -O2 and -O3.
#   no -ffast-math     it permits reassociation and flushes denormals, either of
#                      which silently breaks the mono-sum identity.
#
# MSVC: /fp:precise is the default and is correct; never /fp:fast.
# ---------------------------------------------------------------------------
if(MSVC)
  target_compile_options(monofx_core INTERFACE /fp:precise)
else()
  target_compile_options(monofx_core INTERFACE -ffp-contract=off)
endif()

# Bit-exact parity with the JS reference — and, more importantly, between your
# own Windows/macOS/Linux builds — requires calling the same transcendental
# routines everywhere. See native/README.md.
option(MONOFX_USE_BUNDLED_LIBM "Call a vendored fdlibm instead of the platform libm" OFF)
if(MONOFX_USE_BUNDLED_LIBM)
  target_compile_definitions(monofx_core INTERFACE MONOFX_USE_BUNDLED_LIBM=1)
endif()

add_executable(monofx_diff tests/diff_main.cpp)
target_link_libraries(monofx_diff PRIVATE monofx_core)

enable_testing()
add_test(NAME differential
         COMMAND monofx_diff ${CMAKE_CURRENT_SOURCE_DIR}/../vectors)
