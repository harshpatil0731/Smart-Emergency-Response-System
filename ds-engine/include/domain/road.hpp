#pragma once

#include <string>
#include "domain/enums.hpp"

namespace emergency {

struct Road {
    std::string id;
    std::string fromNodeId;
    std::string toNodeId;
    double weightKm{};
    RoadStatus status{RoadStatus::OPEN};
};

}  // namespace emergency
