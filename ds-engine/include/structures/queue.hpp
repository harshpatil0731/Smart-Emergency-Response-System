#pragma once

#include <cstddef>
#include <optional>
#include <utility>

namespace emergency {

// FIFO queue with explicit linked nodes; used for incoming domain events.
template <typename T>
class Queue {
public:
    Queue() = default;
    Queue(const Queue&) = delete;
    Queue& operator=(const Queue&) = delete;
    ~Queue() { while (dequeue().has_value()) {} }
    void enqueue(const T& value) { add(new Node(value)); }
    void enqueue(T&& value) { add(new Node(std::move(value))); }
    [[nodiscard]] std::optional<T> dequeue() { if (!head_) return std::nullopt; Node* old = head_; T value = std::move(old->value); head_ = old->next; if (!head_) tail_ = nullptr; delete old; --size_; return value; }
    [[nodiscard]] T* front() { return head_ ? &head_->value : nullptr; }
    [[nodiscard]] bool empty() const { return size_ == 0; }
    [[nodiscard]] std::size_t size() const { return size_; }
private:
    struct Node { T value; Node* next{nullptr}; explicit Node(const T& v) : value(v) {} explicit Node(T&& v) : value(std::move(v)) {} };
    Node* head_{nullptr}; Node* tail_{nullptr}; std::size_t size_{};
    void add(Node* node) { if (tail_) tail_->next = node; else head_ = node; tail_ = node; ++size_; }
};

}  // namespace emergency
