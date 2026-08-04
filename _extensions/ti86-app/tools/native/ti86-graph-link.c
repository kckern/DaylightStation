/*
 * Minimal macOS TI-86 Graph Link diagnostic utility.
 *
 * This is intentionally a thin host test tool, not part of the ESP relay. It
 * uses the maintained tilibs protocol implementation to send a variable,
 * silently request one named variable, create/restore a complete backup, dump
 * the calculator's own ROM for legal emulation, or list its directory. The
 * SilverLink reset/reopen sequence works around stale USB endpoints observed
 * with the physical TI-GRAPH LINK USB adapter on macOS.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <fcntl.h>
#include <stdint.h>
#include <unistd.h>

#include <ticables.h>
#include <ticalcs.h>
#include <tifiles.h>
#include <types86.h>

typedef struct {
  CableHandle *cable;
  CalcHandle *calc;
} LinkHandles;

static void close_link(LinkHandles *handles) {
  if (handles->calc) {
    ticalcs_cable_detach(handles->calc);
    ticalcs_handle_del(handles->calc);
  }
  if (handles->cable) ticables_handle_del(handles->cable);
  handles->calc = NULL;
  handles->cable = NULL;
}

static int attach(LinkHandles *handles) {
  const char *serial_device = getenv("TI86_CABLE_DEVICE");
  handles->cable = ticables_handle_new(serial_device ? CABLE_GRY : CABLE_SLV, PORT_1);
  handles->calc = ticalcs_handle_new(CALC_TI86);
  if (!handles->cable || !handles->calc) return 1;
  if (serial_device) {
    int error = ticables_cable_set_device(handles->cable, serial_device);
    if (error) return error;
  }
  ticables_options_set_timeout(handles->cable, 50);
  int error = ticalcs_cable_attach(handles->calc, handles->cable);
  if (!error && serial_device) {
    /* libticables opens macOS Grey Link devices with O_NDELAY. That makes a
     * PTY read return EAGAIN immediately instead of honoring termios VTIME,
     * so MAME never has time to return the calculator ACK. */
    const int descriptor = (int)(intptr_t)handles->cable->priv;
    const int flags = fcntl(descriptor, F_GETFL);
    if (flags < 0 || fcntl(descriptor, F_SETFL, flags & ~O_NONBLOCK) < 0) return 1;
  }
  return error;
}

static int open_recovered(LinkHandles *handles) {
  int error = attach(handles);
  if (error) return error;

  /* A MAME Grey Link HLE endpoint is already a fresh serial connection. */
  if (getenv("TI86_CABLE_DEVICE")) return 0;

  fprintf(stderr, "[ti86] recovering SilverLink USB endpoints...\n");
  error = ticables_cable_reset(handles->cable);
  close_link(handles);
  if (error) return error;
  sleep(3);
  return attach(handles);
}

static int send_file(CalcHandle *calc, const char *filename) {
  fprintf(stderr, "[ti86] sending %s...\n", filename);
  return ticalcs_calc_send_var2(calc, MODE_NORMAL, filename);
}

static int receive_variable(CalcHandle *calc, uint8_t type, const char *kind,
                            const char *name, const char *filename) {
  VarRequest request;
  memset(&request, 0, sizeof(request));
  request.type = type;
  strncpy(request.name, name, sizeof(request.name) - 1);
  fprintf(stderr, "[ti86] requesting %s %s -> %s...\n", kind, name, filename);
  return ticalcs_calc_recv_var2(calc, MODE_NORMAL, filename, &request);
}

static int receive_backup(CalcHandle *calc, const char *filename) {
  fprintf(stderr, "[ti86] receiving complete calculator backup -> %s...\n", filename);
  return ticalcs_calc_recv_backup2(calc, filename);
}

static int send_backup(CalcHandle *calc, const char *filename) {
  fprintf(stderr, "[ti86] restoring complete calculator backup from %s...\n", filename);
  return ticalcs_calc_send_backup2(calc, filename);
}

static int dump_rom(CalcHandle *calc, const char *filename) {
  fprintf(stderr, "[ti86] sending the maintained libticalcs TI-86 ROM dumper...\n");
  int error = ticalcs_calc_dump_rom_1(calc);
  if (error) return error;
  fprintf(stderr, "[ti86] launching dumper and receiving this calculator's ROM -> %s...\n", filename);
  return ticalcs_calc_dump_rom_2(calc, ROMSIZE_AUTO, filename);
}

static int receive_rom(CalcHandle *calc, const char *filename) {
  fprintf(stderr, "[ti86] resuming an already-running ROM dumper -> %s...\n", filename);
  return ticalcs_calc_dump_rom_2(calc, ROMSIZE_AUTO, filename);
}

static int list_variables(CalcHandle *calc) {
  GNode *variables = NULL;
  GNode *applications = NULL;
  int error = ticalcs_calc_get_dirlist(calc, &variables, &applications);
  if (!error) {
    ticalcs_dirlist_display(variables);
    ticalcs_dirlist_destroy(&variables);
    ticalcs_dirlist_destroy(&applications);
  }
  return error;
}

/* Deliberately narrow: this diagnostic CLI can remove only a Program variable.
 * It is used to retire obsolete launchers without risking SchoolCalc state or
 * content Strings. */
static int delete_program(CalcHandle *calc, const char *name) {
  static const uint16_t keys[] = {
    0x40, 0x09, 0x09,             /* Quit, Clear, Clear */
    0x3e, 0x9d, 0x04,             /* Catalog, D, Down */
    0x04, 0x04, 0x05              /* Down, Down, Enter */
  };
  int error = 0;
  fprintf(stderr, "[ti86] deleting Program %s...\n", name);
  for (size_t index = 0; !error && index < sizeof(keys) / sizeof(keys[0]); index++) {
    error = ticalcs_calc_send_key(calc, keys[index]);
    usleep(250000);
  }
  for (size_t index = 0; !error && name[index]; index++) {
    const char c = (char)toupper((unsigned char)name[index]);
    const uint32_t key = isdigit((unsigned char)c) ? 0x008e + c - '0' : 0x009a + c - 'A';
    error = ticalcs_calc_send_key(calc, key);
    usleep(250000);
  }
  if (!error) error = ticalcs_calc_send_key(calc, 0x0005); /* Enter */
  return error;
}

static void usage(const char *program) {
  fprintf(stderr,
    "usage:\n"
    "  %s send FILE.86p [MORE_FILES...]\n"
    "  %s receive STRING_NAME OUTPUT.86s\n"
    "  %s receive-program PROGRAM_NAME OUTPUT.86p\n"
    "  %s backup OUTPUT.86b\n"
    "  %s restore INPUT.86b\n"
    "  %s romdump OUTPUT.rom\n"
    "  %s romreceive OUTPUT.rom\n"
    "  %s list\n"
    "  %s delete-program PROGRAM_NAME\n"
    "\n"
    "Set TI86_CABLE_DEVICE=/dev/tty... to use a Grey Link serial/PTY endpoint\n"
    "instead of the physical SilverLink USB adapter.\n",
    program, program, program, program, program, program, program, program, program);
}

int main(int argc, char **argv) {
  if (argc < 2) {
    usage(argv[0]);
    return 64;
  }
  if ((!strcmp(argv[1], "send") && argc < 3)
      || (!strcmp(argv[1], "receive") && argc != 4)
      || (!strcmp(argv[1], "receive-program") && argc != 4)
      || (!strcmp(argv[1], "backup") && argc != 3)
      || (!strcmp(argv[1], "restore") && argc != 3)
      || (!strcmp(argv[1], "romdump") && argc != 3)
      || (!strcmp(argv[1], "romreceive") && argc != 3)
      || (!strcmp(argv[1], "list") && argc != 2)
      || (!strcmp(argv[1], "delete-program") && argc != 3)) {
    usage(argv[0]);
    return 64;
  }

  ticables_library_init();
  tifiles_library_init();
  ticalcs_library_init();
  LinkHandles handles = { 0 };
  int error = open_recovered(&handles);
  if (!error) {
    if (!strcmp(argv[1], "send")) {
      for (int index = 2; !error && index < argc; index++) {
        error = send_file(handles.calc, argv[index]);
      }
    }
    else if (!strcmp(argv[1], "receive")) {
      error = receive_variable(handles.calc, TI86_STRNG, "String", argv[2], argv[3]);
    } else if (!strcmp(argv[1], "receive-program")) {
      error = receive_variable(handles.calc, TI86_PRGM, "Program", argv[2], argv[3]);
    }
    else if (!strcmp(argv[1], "backup")) error = receive_backup(handles.calc, argv[2]);
    else if (!strcmp(argv[1], "restore")) error = send_backup(handles.calc, argv[2]);
    else if (!strcmp(argv[1], "romdump")) error = dump_rom(handles.calc, argv[2]);
    else if (!strcmp(argv[1], "romreceive")) error = receive_rom(handles.calc, argv[2]);
    else if (!strcmp(argv[1], "list")) error = list_variables(handles.calc);
    else if (!strcmp(argv[1], "delete-program")) error = delete_program(handles.calc, argv[2]);
    else {
      usage(argv[0]);
      error = 64;
    }
  }

  close_link(&handles);
  ticalcs_library_exit();
  tifiles_library_exit();
  ticables_library_exit();
  if (error) {
    fprintf(stderr, "[ti86] operation failed: %d\n", error);
    return 1;
  }
  fprintf(stderr, "[ti86] operation completed\n");
  return 0;
}
