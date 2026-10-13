#include <cstdarg>
#include <cstdio>
#include <cstdlib>

extern "C" {
#include "tilem.h"
}

extern "C" void tilem_free(void* pointer) { std::free(pointer); }

extern "C" void* tilem_malloc(size_t size) {
  void* pointer = std::malloc(size);
  if (pointer == nullptr) std::abort();
  return pointer;
}

extern "C" void* tilem_realloc(void* pointer, size_t size) {
  void* result = std::realloc(pointer, size);
  if (result == nullptr && size != 0) std::abort();
  return result;
}

extern "C" void* tilem_try_malloc(size_t size) { return std::malloc(size); }
extern "C" void* tilem_malloc0(size_t size) {
  void* pointer = std::calloc(1, size);
  if (pointer == nullptr) std::abort();
  return pointer;
}
extern "C" void* tilem_try_malloc0(size_t size) { return std::calloc(1, size); }
extern "C" void* tilem_malloc_atomic(size_t size) { return tilem_malloc(size); }
extern "C" void* tilem_try_malloc_atomic(size_t size) { return tilem_try_malloc(size); }

namespace {

void logMessage(const char* prefix, const char* message, va_list arguments) {
  std::fputs(prefix, stderr);
  std::vfprintf(stderr, message, arguments);
  std::fputc('\n', stderr);
}

}  // namespace

extern "C" void tilem_message(TilemCalc*, const char* message, ...) {
  va_list arguments;
  va_start(arguments, message);
  logMessage("[tilem] ", message, arguments);
  va_end(arguments);
}

extern "C" void tilem_warning(TilemCalc*, const char* message, ...) {
  va_list arguments;
  va_start(arguments, message);
  logMessage("[tilem warning] ", message, arguments);
  va_end(arguments);
}

extern "C" void tilem_internal(TilemCalc*, const char* message, ...) {
  va_list arguments;
  va_start(arguments, message);
  logMessage("[tilem internal] ", message, arguments);
  va_end(arguments);
}
