// Mirrors the `PARAMS` table each JS core declares. One descriptor table drives
// the APVTS layout, the editor's knob row, and the parameter->field bridge, so
// adding a fifth effect stays a single file.
#pragma once

namespace monofx {

struct ParamDescriptor {
  const char* id;
  const char* label;
  double min;
  double max;
  double def;
  bool log;          // maps to NormalisableRange::skewFactorFromMidPoint
  const char* unit;
  int dp;            // decimal places for display
};

}  // namespace monofx
