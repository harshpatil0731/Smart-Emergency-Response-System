#pragma once

#include <optional>
#include "domain/emergency.hpp"
#include "services/priority_policy.hpp"
#include "structures/binary_heap.hpp"

namespace emergency {

struct EmergencyHigherPriority {
    bool operator()(const Emergency& a, const Emergency& b) const { return PriorityPolicy::comesBefore(a, b); }
};

class EmergencyScheduler {
public:
    void enqueue(const Emergency& emergency) { heap_.push(emergency); }
    void requeue(const Emergency& emergency) { heap_.push(emergency); }
    [[nodiscard]] std::optional<Emergency> popNext() { return heap_.pop(); }
    [[nodiscard]] const Emergency* peekNext() const { return heap_.peek(); }
    [[nodiscard]] bool empty() const { return heap_.empty(); }
    [[nodiscard]] std::size_t size() const { return heap_.size(); }
private:
    BinaryHeap<Emergency, EmergencyHigherPriority> heap_;
};

}  // namespace emergency
