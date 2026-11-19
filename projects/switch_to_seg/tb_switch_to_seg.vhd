----------------------------------------------------------------------------------
-- Project Name : switch_to_seg
-- Testbench For: switch_to_seg
-- Module Name  : tb_switch_to_seg.vhd
-- Entity Name  : tb_switch_to_seg
-- Target Lang  : VHDL-2008
-- Description  : Verification testbench for DIP switch to 7-segment display decoder
----------------------------------------------------------------------------------

library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity tb_switch_to_seg is
end entity tb_switch_to_seg;

architecture sim of tb_switch_to_seg is

  -- internal interconnect & stimulus signals
  signal sw      : std_logic_vector(7 downto 0) := (others => '0');
  signal en      : std_logic := '0';
  signal hex_hi  : std_logic_vector(3 downto 0) := (others => '0');
  signal hex_lo  : std_logic_vector(3 downto 0) := (others => '0');
  signal led_on  : std_logic := '0';

begin

  -- instantiate unit under test (DUT)
  dut : entity work.switch_to_seg
    port map (
      sw      => sw,
      en      => en,
      hex_hi  => hex_hi,
      hex_lo  => hex_lo,
      led_on  => led_on
    );

  -- stimulus process: drive verification stimulus vectors
  stim_proc : process
  begin
    -- Test 1: Initial state (switches=0x00, disabled -> outputs=0, led=0)
    en <= '0';
    sw <= x"00";
    wait for 40 ns;

    -- Test 2: Set switches to 0x5A while disabled (outputs must remain 0)
    sw <= x"5A";
    wait for 40 ns;

    -- Test 3: Enable display (en='1') -> hex_hi=5, hex_lo=A, led_on=1
    en <= '1';
    wait for 50 ns;

    -- Test 4: Change switches to 0x3F (3 on hex_hi, F on hex_lo)
    sw <= x"3F";
    wait for 50 ns;

    -- Test 5: Change switches to 0xC8 (C on hex_hi, 8 on hex_lo)
    sw <= x"C8";
    wait for 50 ns;

    -- Test 6: Change switches to 0x9B (9 on hex_hi, B on hex_lo)
    sw <= x"9B";
    wait for 50 ns;

    -- Test 7: Release push button / disable (en='0') -> display turns off
    en <= '0';
    wait for 40 ns;

    -- Test 8: Re-enable with 0x7E
    sw <= x"7E";
    en <= '1';
    wait for 60 ns;

    wait; -- simulation complete
  end process stim_proc;

end architecture sim;
