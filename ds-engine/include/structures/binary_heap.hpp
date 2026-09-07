#pragma once

#include <cstddef>
#include <optional>
#include <utility>
#include <vector>

namespace emergency {

// Array-backed binary heap. Compare(a, b) is true when a has higher priority than b.
template <typename T, typename Compare>
class BinaryHeap {
public:
    explicit BinaryHeap(Compare compare = Compare{}) : compare_(std::move(compare)) {}
    void push(const T& value) { values_.push_back(value); bubbleUp(values_.size() - 1); }
    void push(T&& value) { values_.push_back(std::move(value)); bubbleUp(values_.size() - 1); }
    [[nodiscard]] std::optional<T> pop() { if (values_.empty()) return std::nullopt; T result = std::move(values_.front()); values_.front() = std::move(values_.back()); values_.pop_back(); if (!values_.empty()) bubbleDown(0); return result; }
    [[nodiscard]] T* peek() { return values_.empty() ? nullptr : &values_.front(); }
    [[nodiscard]] const T* peek() const { return values_.empty() ? nullptr : &values_.front(); }
    [[nodiscard]] bool empty() const { return values_.empty(); }
    [[nodiscard]] std::size_t size() const { return values_.size(); }
private:
    std::vector<T> values_; Compare compare_;
    void bubbleUp(std::size_t child) { while (child > 0) { const std::size_t parent = (child - 1) / 2; if (!compare_(values_[child], values_[parent])) break; std::swap(values_[child], values_[parent]); child = parent; } }
    void bubbleDown(std::size_t parent) { while (true) { const std::size_t left = parent * 2 + 1, right = left + 1; std::size_t best = parent; if (left < values_.size() && compare_(values_[left], values_[best])) best = left; if (right < values_.size() && compare_(values_[right], values_[best])) best = right; if (best == parent) break; std::swap(values_[parent], values_[best]); parent = best; } }
};

}  // namespace emergency
