----------------------------------------------------------------------------------
-- Project Name : and22
-- Testbench For: and22
-- Module Name  : tb_and22.vhd
-- Entity Name  : tb_and22
-- Target Lang  : VHDL-2008
-- Engineer     : Jalali
-- Create Date  : 2026-11-06
-- Tool Versions: GHDL 6.0.0
----------------------------------------------------------------------------------

library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity tb_and22 is
end entity tb_and22;

architecture sim of tb_and22 is

  -- clock period constant
  constant CLK_PERIOD : time := 10 ns;

  -- internal interconnect & stimulus signals
  signal A          : std_logic := '0';
  signal B          : std_logic := '0';
  signal Y          : std_logic := '0';

begin

  -- instantiate unit under test (DUT)
  dut : entity work.and22
    port map (
      A          => A,
      B          => B,
      Y          => Y
    );

  -- stimulus process: drive input vectors
  stim_proc : process
  begin
    -- initial stimulus state
    A <= '0';
    B <= '0';
    wait for 20 ns;
            A <= '1';
    B <= '0';
    wait for 20 ns;
            A <= '0';
    B <= '1';
    wait for 20 ns;
            A <= '1';
    B <= '1';
wait for 20 ns;




    wait; -- simulation complete
  end process stim_proc;

end architecture sim;
