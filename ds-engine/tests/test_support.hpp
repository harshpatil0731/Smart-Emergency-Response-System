#pragma once

#include <cmath>
#include <iostream>
#include <stdexcept>
#include <string>

inline void require(bool condition, const std::string& message) {
    if (!condition) throw std::runtime_error(message);
}

inline void requireNear(double actual, double expected, double tolerance, const std::string& message) {
    require(std::abs(actual - expected) <= tolerance, message);
}

inline int runTests(const std::string& group, const auto& function) {
    try { function(); std::cout << group << ": PASS\n"; return 0; }
    catch (const std::exception& error) { std::cerr << group << ": FAIL - " << error.what() << "\n"; return 1; }
}
